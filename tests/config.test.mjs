import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateEnv, serviceConfigs, generate } from '../dist/runtime/config.js';
import { encodeEnv, decodeEnv, atomicWrite, readEnv } from '../dist/config/files.js';
import { fields, generateKey } from '../dist/config/settings.js';

export const settings = {
  MEMORY_PROXY_PUBLIC_URL: 'https://models.test.invalid', KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid', PANEL_PUBLIC_URL: 'https://panel.third.invalid',
  LLM_BASE_URL: 'https://provider.test.invalid/v1', LLM_API_KEY: 'provider-key', MEMORY_LLM_MODEL: 'memory-test', KNOWLEDGE_LLM_MODEL: 'knowledge-test',
  CORE_API_KEY: generateKey('core'), CLIPROXY_API_KEY: generateKey('cliproxy'),
};
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'ams-config-'));
  t.after(() => rm(path, { force: true, recursive: true }));
  return path;
}
test('independent cryptographic key roles, no imposed provider prefix', () => {
  const keys = ['core', 'cliproxy', 'admin'].map(generateKey);
  for (let i = 0; i < keys.length; i++) assert.match(keys[i], /^sk-ams-(core|cliproxy|admin)-[a-f0-9]{64}$/);
  assert.equal(new Set(keys.map(key => key.slice(-64))).size, 3);
  assert.equal(validateEnv(settings).LLM_API_KEY, 'provider-key');
});
test('origins, API bases, ports and mandatory values are validated without leaking secrets', () => {
  for (const invalid of [
    { MEMORY_PROXY_PUBLIC_URL: 'https://api.example.com' }, { KNOWLEDGE_PUBLIC_URL: 'https://wiki.invalid/v3' },
    { PANEL_PUBLIC_URL: 'ftp://panel.invalid' }, { LLM_BASE_URL: 'https://api.invalid/v1/chat/completions' },
    { MEMORY_LLM_MODEL: '' }, { PANEL_PORT: '65536' }, { LLM_API_KEY: '' },
  ]) assert.throws(() => validateEnv({ ...settings, ...invalid }), error => !error.message.includes(settings.CORE_API_KEY));
  const env = validateEnv({ ...settings, KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true', KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid/' });
  assert.equal(env.KNOWLEDGE_PUBLIC_URL, 'https://wiki.other.invalid');
  for (const address of ['http://localhost:8096', 'http://127.0.0.1:8422', 'http://192.168.1.5:8123', 'https://panel.invalid']) {
    assert.equal(validateEnv({ ...settings, PANEL_PUBLIC_URL: address }).PANEL_PUBLIC_URL, address);
  }
  const configs = serviceConfigs(env);
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_URL, env.KNOWLEDGE_PUBLIC_URL);
  assert.equal(configs['knowledge-env.json'].KNOWLEDGE_PUBLIC_BASE_URL, env.KNOWLEDGE_PUBLIC_URL + '/v3');
  assert.equal(configs['proxy-env.json'].AMS_PROXY_URL, env.MEMORY_PROXY_PUBLIC_URL);
  assert.equal(configs['proxy.yaml'].auth.url, 'http://core:8420');
});
test('env roundtrip and actual process preload preserve quotes, backslashes and literal dollars', async t => {
  const dir = await directory(t);
  const key = 'provider-\'"\\$value-${DO_NOT_EXPAND}-`';
  const env = validateEnv({ ...settings, LLM_API_KEY: key });
  await atomicWrite(join(dir, '.env'), encodeEnv(env));
  assert.deepEqual(await readEnv(join(dir, '.env')), env);
  assert.equal(decodeEnv("LLM_API_KEY='literal-$value'\n").LLM_API_KEY, 'literal-$value');
  await generate(dir);
  const result = spawnSync(process.execPath, ['--import', './dist/runtime/environment.js', '-e', 'process.stdout.write(process.env.TDAI_LLM_API_KEY)'], {
    encoding: 'utf8', env: { ...process.env, AMS_ENV_FILE: join(dir, 'generated/core-env.json'), DO_NOT_EXPAND: 'incorrect' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, key);
  assert.equal((await stat(join(dir, '.env'))).mode & 0o777, 0o600);
  await assert.rejects(stat(join(dir, '.admin-key')), { code: 'ENOENT' });
});
test('applying changed settings preserves service keys and keeps Panel from replacing internal LLM binding', async t => {
  const dir = await directory(t);
  const env = validateEnv(settings);
  await atomicWrite(join(dir, '.env'), encodeEnv(env));
  await generate(dir);
  await atomicWrite(join(dir, '.env'), encodeEnv({ ...env, MEMORY_LLM_MODEL: 'new-model' }));
  await generate(dir);
  const configs = serviceConfigs(await readEnv(join(dir, '.env')));
  assert.equal(configs['core-env.json'].TDAI_LLM_MODEL, 'new-model');
  assert.equal(configs['core-env.json'].TDAI_GATEWAY_API_KEY, env.CORE_API_KEY);
  assert.equal(configs['knowledge-env.json'].LLM_MODEL, 'knowledge-test');
  assert.equal(configs['panel-env.json'].KNOWLEDGE_LLM_BINDING_SYNC, 'false');
  assert.equal((await stat(join(dir, 'generated/core-env.json'))).mode & 0o777, 0o600);
  await assert.rejects(readFile(join(dir, 'generated/Caddyfile')), { code: 'ENOENT' });
  const template = decodeEnv(await readFile('server/.env.example', 'utf8'));
  assert.deepEqual(Object.keys(template).sort(), fields.map(f => f.name).sort());
});
