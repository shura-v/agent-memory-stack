import { installNativeSourceFixture } from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSettings, generate } from '../dist/runtime/config.js';
import { encodeEnv, decodeEnv, atomicWrite, readEnv } from '../dist/config/files.js';
import { fields, generateKey, isNativeSetting } from '../dist/config/settings.js';
import { prepareNativeConfiguration, saveNativeConfiguration, stageNativeRuntime } from '../dist/config/native-state.js';
import { parseNativeDocument } from '../dist/config/native-documents.js';

export const settings = {
  MEMORY_PROXY_PUBLIC_URL: 'https://models.test.invalid', KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid', PANEL_PUBLIC_URL: 'https://panel.third.invalid',
  LLM_BASE_URL: 'https://provider.test.invalid/v1', LLM_API_KEY: 'provider-key', MEMORY_LLM_MODEL: 'memory-test', KNOWLEDGE_LLM_MODEL: 'knowledge-test',
  CORE_API_KEY: generateKey('core'), CLIPROXY_API_KEY: generateKey('cliproxy'),
};
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'ams-config-'));
  t.after(() => rm(path, { force: true, recursive: true }));
  await installNativeSourceFixture(path);
  return path;
}
async function generateNative(directory, env, edits) {
  const candidate = await prepareNativeConfiguration(directory, env, { root: join(directory, 'native'), edits });
  await saveNativeConfiguration(directory, candidate);
  await stageNativeRuntime(directory, candidate, env);
  return generate(directory);
}
test('independent cryptographic key roles, no imposed provider prefix', () => {
  const keys = ['core', 'cliproxy', 'admin'].map(generateKey);
  for (let i = 0; i < keys.length; i++) assert.match(keys[i], /^sk-ams-(core|cliproxy|admin)-[a-f0-9]{64}$/);
  assert.equal(new Set(keys.map(key => key.slice(-64))).size, 3);
  assert.equal(resolveSettings(settings).LLM_API_KEY, 'provider-key');
});
test('settings values remain unchanged without AMS validation', () => {
  for (const invalid of [
    { PANEL_PUBLIC_URL: 'ftp://panel.invalid' }, { PANEL_PORT: '65536' },
  ]) assert.deepEqual(Object.fromEntries(Object.keys(invalid).map(name => [name, resolveSettings({ ...settings, ...invalid })[name]])), invalid);
  const env = resolveSettings({ ...settings, KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true', KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid/' });
  assert.equal(env.KNOWLEDGE_PUBLIC_URL, 'https://wiki.other.invalid/');
  for (const address of ['http://localhost:8096', 'http://127.0.0.1:8422', 'http://192.168.1.5:8123', 'https://panel.invalid']) {
    assert.equal(resolveSettings({ ...settings, PANEL_PUBLIC_URL: address }).PANEL_PUBLIC_URL, address);
  }

});
test('native documents retain configured scalar bytes without process override injection', async t => {
  const dir = await directory(t);
  const key = 'provider-\'"\\$value-${DO_NOT_EXPAND}-`';
  const env = resolveSettings({ ...settings, LLM_API_KEY: key });
  await atomicWrite(join(dir, '.env'), encodeEnv(env));
  assert.deepEqual(await readEnv(join(dir, '.env')), env);
  assert.equal(decodeEnv("LLM_API_KEY='literal-$value'\n").LLM_API_KEY, 'literal-$value');
  const { generated } = await generateNative(dir, env);
  assert.equal(parseNativeDocument(await readFile(join(generated, 'core.yaml'), 'utf8'), 'yaml').llm.apiKey, key);
  await assert.rejects(readFile(join(generated, 'core-env.json')), { code: 'ENOENT' });
  assert.equal((await stat(join(dir, '.env'))).mode & 0o777, 0o600);
  await assert.rejects(stat(join(dir, '.admin-key')), { code: 'ENOENT' });
});
test('applying changed settings preserves service keys and keeps Panel from replacing internal LLM binding', async t => {
  const dir = await directory(t);
  const env = resolveSettings(settings);
  await atomicWrite(join(dir, '.env'), encodeEnv(env));
  const original = await generateNative(dir, env);
  const { generated } = await generateNative(dir, env, { MEMORY_LLM_MODEL: 'new-model' });
  const core = parseNativeDocument(await readFile(join(generated, 'core.yaml'), 'utf8'), 'yaml');
  const knowledge = parseNativeDocument(await readFile(join(generated, 'knowledge.env'), 'utf8'), 'env');
  const panel = parseNativeDocument(await readFile(join(generated, 'panel.env'), 'utf8'), 'env');
  assert.equal(core.llm.model, 'new-model');
  assert.equal(core.server.apiKey, env.CORE_API_KEY);
  assert.equal(knowledge.LLM_MODEL, 'knowledge-test');
  assert.equal(panel.KNOWLEDGE_LLM_BINDING_SYNC, 'false');
  assert.equal((await stat(join(generated, 'core.yaml'))).mode & 0o777, 0o600);
  assert.equal(parseNativeDocument(await readFile(join(original.generated, 'core.yaml'), 'utf8'), 'yaml').llm.model, 'memory-test');
  await assert.rejects(readFile(join(generated, 'Caddyfile')), { code: 'ENOENT' });
  const template = decodeEnv(await readFile('server/.env.example', 'utf8'));
  assert.deepEqual(Object.keys(template).sort(), fields.filter(f => !isNativeSetting(f.name)).map(f => f.name).sort());
});
