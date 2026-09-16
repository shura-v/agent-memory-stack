import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveResolvedNetwork } from '../dist/setup/network-settings.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';

test('allocation updates legacy localhost origins while retaining custom domains, provider URLs and comments', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-network-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.ams'));
  const env = {
    MEMORY_PROXY_PORT: '8096', MEMORY_PROXY_PUBLIC_URL: 'http://localhost:8096',
    PANEL_PORT: '8123', PANEL_PUBLIC_URL: 'https://panel.example.com',
    KNOWLEDGE_PORT: '8422', KNOWLEDGE_PUBLIC_URL: 'http://127.0.0.1:9999',
    LLM_BASE_URL: 'https://provider.example.com/v1', LLM_API_KEY: 'never-in-provenance',
  };
  await writeFile(join(dir, '.env'), '# My configuration\n' + encodeEnv(env));
  const resolved = await saveResolvedNetwork(dir, env, { MEMORY_PROXY_PORT: '49100', PANEL_PORT: '49101', KNOWLEDGE_PORT: '49102' });
  assert.equal(resolved.MEMORY_PROXY_PUBLIC_URL, 'http://localhost:49100');
  assert.equal(resolved.PANEL_PUBLIC_URL, env.PANEL_PUBLIC_URL);
  assert.equal(resolved.KNOWLEDGE_PUBLIC_URL, env.KNOWLEDGE_PUBLIC_URL);
  assert.equal(resolved.LLM_BASE_URL, env.LLM_BASE_URL);
  assert.deepEqual(await readEnv(join(dir, '.env')), resolved);
  assert.match(await readFile(join(dir, '.env'), 'utf8'), /^# My configuration\n/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.ams/network.json'), 'utf8')), {
    version: 1, generatedOrigins: { MEMORY_PROXY_PUBLIC_URL: 'http://localhost:49100' },
  });
  // A subsequent explicit localhost override is manual too, even when it matches the port.
  resolved.MEMORY_PROXY_PUBLIC_URL = 'http://127.0.0.1:49100';
  await writeFile(join(dir, '.env'), encodeEnv(resolved));
  const next = await saveResolvedNetwork(dir, resolved, { MEMORY_PROXY_PORT: '49200' });
  assert.equal(next.MEMORY_PROXY_PUBLIC_URL, 'http://127.0.0.1:49100');
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.ams/network.json'), 'utf8')).generatedOrigins, {});
  // Removing an override restores automatic generation, including its new port.
  delete next.PANEL_PUBLIC_URL;
  await writeFile(join(dir, '.env'), encodeEnv(next));
  const defaults = { ...next, PANEL_PUBLIC_URL: `http://127.0.0.1:${next.PANEL_PORT}` };
  const restored = await saveResolvedNetwork(dir, defaults, { PANEL_PORT: '49201' });
  assert.equal(restored.PANEL_PUBLIC_URL, 'http://127.0.0.1:49201');
  assert.equal((await readEnv(join(dir, '.env'))).PANEL_PUBLIC_URL, restored.PANEL_PUBLIC_URL);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.ams/network.json'), 'utf8')).generatedOrigins, { PANEL_PUBLIC_URL: 'http://127.0.0.1:49201' });
});
