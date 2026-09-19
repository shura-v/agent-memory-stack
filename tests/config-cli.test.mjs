import { installNativeSourceFixture } from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { setupServer, savedProvider } from '../dist/setup/server.js';
import { readEnv, encodeEnv } from '../dist/config/files.js';

async function snapshot(directory) {
  const result = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    result[item.name] = item.isDirectory() ? await snapshot(path) : await readFile(path, 'utf8');
  }
  return result;
}
async function installation(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-config-check-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await installNativeSourceFixture(directory);
  const answers = { INTERNAL_LLM_SOURCE: 'external', LLM_BASE_URL: 'https://synthetic.invalid/v1', LLM_API_KEY: 'synthetic-provider', MEMORY_LLM_MODEL: 'core-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model' };
  const ui = { select: async (id, _label, choices, initial) => answers[id] ?? initial ?? choices[0].value,
    text: async q => answers[q.id] ?? q.initial ?? '', confirm: async () => false, note() {} };
  await setupServer(ui, { directory, nativeRoot: join(directory, 'native'), listModels: async () => [],
    runtime: () => assert.fail('save only'), prepareImages: () => assert.fail('save only') });
  return directory;
}
const check = directory => spawnSync(process.execPath, ['dist/runtime/config.js', 'check', directory], { encoding: 'utf8' });

test('standalone check reads composed native files without validating or changing setting values', async t => {
  const directory = await installation(t);
  const env = await readEnv(join(directory, '.env'));
  assert.equal(env.CORE_API_KEY, undefined);
  assert.equal(env.MEMORY_LLM_MODEL, undefined);
  assert.equal(check(directory).status, 0, 'filtered setup environment is accepted');
  await writeFile(join(directory, '.env'), encodeEnv({ ...env, DATA_DIR: '$operator:path', PANEL_PORT: 'operator-port', CLIPROXY_AUTH_PROVIDER: 'operator-provider', LOG_LEVEL: '' }));
  await writeFile(join(directory, '.ams/runtime.json'), JSON.stringify({ provider: 'operator-compose' }));
  await writeFile(join(directory, 'native/overrides/core.yaml'), 'server:\n  apiKey: ""\nllm:\n  baseUrl: not-an-http-url\n  model: ""\n  maxTokens: operator-value\n');
  await writeFile(join(directory, 'native/overrides/knowledge.env'), 'API_PREFIX=/custom\nPORT=operator-listener\nLLM_API_KEY=\n');
  await writeFile(join(directory, 'native/overrides/proxy.yaml'), 'admin:\n  apiKey: ""\n');
  const before = await snapshot(directory);
  const result = check(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /files loaded successfully/);
  assert.equal(await savedProvider(directory), 'operator-compose');
  assert.deepEqual(await snapshot(directory), before, 'check is read-only');
});

test('standalone check still reports unreadable or malformed configuration without exposing contents', async t => {
  const directory = await installation(t);
  await writeFile(join(directory, 'native/overrides/core.yaml'), 'llm: [secret-not-for-output');
  const result = check(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /syntax.*paths.*permissions/);
  assert.doesNotMatch(result.stderr + result.stdout, /secret-not-for-output/);
  await rm(join(directory, '.env'));
  assert.equal(check(directory).status, 1);
});
