import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSourceFiles } from './fixtures/native-source.mjs';
import { parseNativeDocument, updateNativeDocument } from '../dist/config/native-documents.js';
import { seedNativeServiceConfigs, editNativeServiceOverrides, normalizeNativeServiceConfigs, nativeRuntimeConfigs, proxyAdminKey } from '../dist/config/native-services.js';

const templates = nativeSourceFiles;
const settings = {
  LLM_BASE_URL: 'https://provider.synthetic.invalid/v1', LLM_API_KEY: 'synthetic-provider',
  MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model',
  CORE_API_KEY: 'synthetic-core', CLIPROXY_API_KEY: 'synthetic-cli',
};
const edit = (text, format, path, value) => updateNativeDocument(text, format, [{ path: path.split('.'), value }]);
const yaml = text => parseNativeDocument(text, 'yaml');

test('native seeding retains the full template surface and comments and adopts new untouched defaults', () => {
  const newer = { ...templates, 'core.yaml': edit(templates['core.yaml'], 'yaml', 'llm.maxTokens', 65432) + '\n# future native setting\nfutureOption: { retries: 17 }\n' };
  const documents = seedNativeServiceConfigs(settings, newer);
  assert.equal(yaml(documents['core.yaml']).futureOption.retries, 17);
  assert.match(documents['core.yaml'], /# future native setting/);
  assert.equal(yaml(documents['core.yaml']).llm.maxTokens, 65432);
  assert.equal(yaml(documents['core.yaml']).skill.extraction.queue.maxRetries, 2);
  assert.equal(yaml(documents['proxy.yaml']).sessionInit.maxRetries, 3);
  assert.equal(parseNativeDocument(documents['panel.env'], 'env').METADATA_REMOTE_TIMEOUT_MS, '15000');
  assert.equal(JSON.parse(documents['panel-instances.json']).instances.length, 1);
});

test('initial native proxy admin is independent and accepts an operator credential', () => {
  const documents = seedNativeServiceConfigs(settings, templates);
  const key = proxyAdminKey(documents);
  assert.match(key, /^sk-ams-proxy-admin-[a-f0-9]{64}$/);
  assert.notEqual(key, proxyAdminKey(seedNativeServiceConfigs(settings, templates)));
  assert.equal(proxyAdminKey(seedNativeServiceConfigs(settings, templates, documents)), key);
  const supplied = { ...templates, 'proxy.yaml': edit(templates['proxy.yaml'], 'yaml', 'admin.apiKey', 'operator-admin') };
  assert.equal(proxyAdminKey(seedNativeServiceConfigs(settings, supplied)), 'operator-admin');
  const deleted = { ...documents, 'proxy.yaml': edit(documents['proxy.yaml'], 'yaml', 'admin.apiKey', '') };
  assert.doesNotThrow(() => nativeRuntimeConfigs(settings, deleted));
  assert.equal(proxyAdminKey(deleted), '');
  const reused = { ...documents, 'proxy.yaml': edit(documents['proxy.yaml'], 'yaml', 'admin.apiKey', settings.CORE_API_KEY) };
  assert.doesNotThrow(() => nativeRuntimeConfigs(settings, reused));
});

test('native edits preserve independent Core and Knowledge model settings', () => {
  const documents = seedNativeServiceConfigs(settings, templates);
  documents['core.yaml'] = edit(documents['core.yaml'], 'yaml', 'llm.model', 'manual-core');
  documents['knowledge.env'] = edit(documents['knowledge.env'], 'env', 'LLM_MODEL', 'manual-knowledge');
  documents['knowledge.env'] = edit(documents['knowledge.env'], 'env', 'LLM_API_KEY', 'manual-knowledge-key');
  const normalized = normalizeNativeServiceConfigs(settings, documents);
  assert.equal(normalized.MEMORY_LLM_MODEL, 'manual-core');
  assert.equal(normalized.KNOWLEDGE_LLM_MODEL, 'manual-knowledge');
  const runtime = nativeRuntimeConfigs(settings, documents);
  assert.equal(yaml(documents['core.yaml']).llm.model, 'manual-core');
  assert.equal(parseNativeDocument(documents['knowledge.env'], 'env').LLM_API_KEY, 'manual-knowledge-key');
  for (const name of ['core', 'knowledge', 'panel', 'proxy']) assert.equal(runtime[`${name}-env.json`], undefined);
  assert.ok(runtime['cli-proxy-api.yaml']);
});

test('save-only native seeding initializes every service with pending internal models', () => {
  const input = { CORE_API_KEY: 'core', CLIPROXY_API_KEY: 'cli', INTERNAL_LLM_SOURCE: 'cliproxy' };
  const documents = seedNativeServiceConfigs(input, templates);
  assert.deepEqual(Object.keys(documents).sort(), Object.keys(templates).sort());
  assert.equal(parseNativeDocument(documents['knowledge.env'], 'env').LLM_MODEL, '');
  assert.match(proxyAdminKey(documents), /^sk-ams-proxy-admin-/);
  assert.equal(yaml(documents['core.yaml']).llm.apiKey, 'cli');
  assert.equal(yaml(documents['core.yaml']).llm.model, '');
});

test('stock native files contain no AMS injection variables or identity protocols', () => {
  const documents = seedNativeServiceConfigs(settings, templates);
  for (const name of ['knowledge.env', 'panel.env']) {
    assert.equal(Object.keys(parseNativeDocument(documents[name], 'env')).some(key => key.startsWith('AMS_')), false);
  }
  const panel = parseNativeDocument(documents['panel.env'], 'env');
  assert.equal(panel.KNOWLEDGE_SERVICE_URL, 'http://knowledge:8421');
  const knowledge = parseNativeDocument(documents['knowledge.env'], 'env');
  assert.equal(knowledge.TMC_CALLBACK_URL, 'http://panel:8123');
  assert.deepEqual(Object.keys(nativeRuntimeConfigs(settings, documents)).sort(), ['access-env.json', 'bootstrap-env.json', 'cli-proxy-api.yaml', 'mcp.json']);
  assert.equal(yaml(documents['core.yaml']).server.apiKey, settings.CORE_API_KEY);
  assert.equal(yaml(documents['proxy.yaml']).auth.enabled, true);
});

test('operator-defined native paths reach runtime without AMS value checks', () => {
  const documents = seedNativeServiceConfigs(settings, templates);
  documents['core.yaml'] = edit(documents['core.yaml'], 'yaml', 'data.baseDir', '/unmounted');
  documents['core.yaml'] = edit(documents['core.yaml'], 'yaml', 'metadata.store.sqliteBaseDir', '/operator-metadata');
  assert.equal(yaml(documents['core.yaml']).metadata.store.sqliteBaseDir, '/operator-metadata');
  assert.equal(nativeRuntimeConfigs(settings, documents)['core-env.json'], undefined);
  assert.equal(yaml(documents['core.yaml']).data.baseDir, '/unmounted');
});


test('full native runtime rejects each missing service document', () => {
  const documents = seedNativeServiceConfigs(settings, templates);
  for (const name of Object.keys(templates)) {
    const incomplete = { ...documents };
    delete incomplete[name];
    assert.throws(() => nativeRuntimeConfigs(settings, incomplete), error => error.message === `Missing native configuration: ${name}`);
  }
});


test('seeded and explicitly edited numeric options preserve nonnumeric and empty user values', () => {
  const documents = seedNativeServiceConfigs({ ...settings, MEMORY_LLM_MAX_TOKENS: 'operator-limit', MEMORY_LLM_TIMEOUT_MS: '' }, templates);
  assert.equal(yaml(documents['core.yaml']).llm.maxTokens, 'operator-limit');
  assert.equal(yaml(documents['core.yaml']).llm.timeoutMs, '');
  editNativeServiceOverrides(settings, documents, { MEMORY_LLM_MAX_TOKENS: '', MEMORY_LLM_TIMEOUT_MS: 'operator-timeout' });
  assert.equal(yaml(documents['core.yaml']).llm.maxTokens, '');
  assert.equal(yaml(documents['core.yaml']).llm.timeoutMs, 'operator-timeout');
});

test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access in native unit test'); }));

for (const key of [undefined, '']) test(`fresh native configuration preserves stock consumer tokens without a Core secret (${key === undefined ? 'absent' : 'empty'})`, () => {
  const { CORE_API_KEY: _key, ...input } = settings;
  if (key !== undefined) input.CORE_API_KEY = key;
  const native = { ...templates,
    'proxy.yaml': templates['proxy.yaml'] + '\ntdai: { apiKey: native-memory }\nskill: { serviceToken: native-skill }\nknowledge: { serviceToken: native-knowledge }\n',
    'panel.env': templates['panel.env'] + 'KNOWLEDGE_AUTH_TOKEN=native-knowledge-http\n',
  };
  const documents = seedNativeServiceConfigs(input, native);
  assert.equal(yaml(documents['core.yaml']).server.apiKey, key);
  assert.equal(yaml(documents['proxy.yaml']).tdai.apiKey, 'native-memory');
  assert.equal(yaml(documents['proxy.yaml']).skill.serviceToken, 'native-skill');
  assert.equal(yaml(documents['proxy.yaml']).knowledge.serviceToken, 'native-knowledge');
  assert.equal(JSON.parse(documents['panel-instances.json']).instances[0].api_key, 'local');
  assert.equal(parseNativeDocument(documents['panel.env'], 'env').KNOWLEDGE_AUTH_TOKEN, 'native-knowledge-http');
  assert.equal(yaml(documents['proxy.yaml']).auth.enabled, true);
  assert.match(proxyAdminKey(documents), /^sk-ams-proxy-admin-/);
  const runtime = nativeRuntimeConfigs(input, documents);
  assert.equal(runtime['mcp.json'].coreApiKey, '');
  assert.equal(runtime['bootstrap-env.json'].CORE_API_KEY, '');
  assert.equal(runtime['access-env.json'].CORE_API_KEY, '');
  documents['core.yaml'] = edit(documents['core.yaml'], 'yaml', 'server.apiKey', 'operator-service-key');
  const explicit = nativeRuntimeConfigs(input, documents);
  assert.equal(explicit['mcp.json'].coreApiKey, 'operator-service-key');
  assert.equal(explicit['bootstrap-env.json'].CORE_API_KEY, 'operator-service-key');
  assert.equal(explicit['access-env.json'].CORE_API_KEY, 'operator-service-key');
});
