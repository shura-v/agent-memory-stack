import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveResolvedNetwork } from '../dist/setup/network-settings.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';

test('allocation persists ports and preserves explicit origins, credentials and comments', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-network-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = {
    MEMORY_PROXY_PORT: '8096', MEMORY_PROXY_PUBLIC_URL: 'http://localhost:8096',
    PANEL_PORT: '8123', PANEL_PUBLIC_URL: 'https://panel.synthetic.invalid',
    KNOWLEDGE_PORT: '8422', KNOWLEDGE_PUBLIC_URL: 'http://127.0.0.1:9999',
    LLM_BASE_URL: 'https://provider.synthetic.invalid/v1', LLM_API_KEY: 'literal-$-credential',
  };
  await writeFile(join(dir, '.env'), '# My configuration\n' + encodeEnv(env));
  const ports = { MEMORY_PROXY_PORT: '49100', PANEL_PORT: '49101', KNOWLEDGE_PORT: '49102' };
  const resolved = await saveResolvedNetwork(dir, env, ports);
  assert.deepEqual(resolved, { ...env, ...ports });
  assert.deepEqual(await readEnv(join(dir, '.env')), resolved);
  assert.match(await readFile(join(dir, '.env'), 'utf8'), /^# My configuration\n/);
  await assert.rejects(readFile(join(dir, '.ams/network.json')), { code: 'ENOENT' });
});

test('first allocation returns resolved origin suggestions without persisting a second service-setting owner', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-network-initial-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { MEMORY_PROXY_PORT: '8096', MEMORY_PROXY_PUBLIC_URL: 'http://127.0.0.1:8096',
    PANEL_PORT: '8123', PANEL_PUBLIC_URL: 'https://panel.synthetic.invalid',
    KNOWLEDGE_PORT: '8422', KNOWLEDGE_PUBLIC_URL: 'http://127.0.0.1:8422' };
  await writeFile(join(dir, '.env'), encodeEnv(env));
  const result = await saveResolvedNetwork(dir, env, { MEMORY_PROXY_PORT: '49100', KNOWLEDGE_PORT: '49102' }, { initializeOrigins: true });
  assert.equal(result.MEMORY_PROXY_PUBLIC_URL, 'http://127.0.0.1:49100');
  assert.equal(result.KNOWLEDGE_PUBLIC_URL, 'http://127.0.0.1:49102');
  assert.equal(result.PANEL_PUBLIC_URL, env.PANEL_PUBLIC_URL);
  const persisted = await readEnv(join(dir, '.env'));
  assert.equal(persisted.MEMORY_PROXY_PORT, '49100');
  assert.equal(persisted.MEMORY_PROXY_PUBLIC_URL, env.MEMORY_PROXY_PUBLIC_URL);
});
