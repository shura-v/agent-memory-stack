import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nativeRuntimeConfigs, normalizeNativeServiceConfigs, proxyAdminKey } from '../dist/config/native-services.js';
import { getNativeTemplates } from '../dist/config/native-templates.js';
import { prepareNativeConfiguration, saveNativeConfiguration, readNativeDocuments } from '../dist/config/native-state.js';
import { updateNativeDocument } from '../dist/config/native-documents.js';
import { resolveSettings } from '../dist/config/settings.js';

// Opt in after building the images. All credentials are synthetic; containers
// have no network, publish no ports and execute only upstream configuration code.
const enabled = process.env.AMS_UPSTREAM_CONFIG_TEST === '1';
const engine = process.env.AMS_CONTAINER_ENGINE ?? 'podman';
const imagePrefix = process.env.AMS_TEST_IMAGE_PREFIX ?? 'agent-memory-stack';
const escaped = 'synthetic-\'"\\$value-${DO_NOT_EXPAND}-`';
const settings = resolveSettings({
  MEMORY_PROXY_PUBLIC_URL: 'https://models.synthetic.invalid',
  KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid',
  KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true',
  PANEL_PUBLIC_URL: 'https://panel.third.invalid',
  LLM_BASE_URL: 'https://llm.synthetic.invalid/custom/v4', LLM_API_KEY: escaped,
  MEMORY_LLM_MODEL: 'memory-model-fixture', KNOWLEDGE_LLM_MODEL: 'knowledge-model-fixture',
  CORE_API_KEY: `core-${escaped}`, CLIPROXY_API_KEY: `cli-${escaped}`,
});

async function checkLoader(t, image, imports, body, settingsOverride = settings) {
  const settings = settingsOverride;
  const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ams-upstream-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Synthetic fixtures must be readable by the images' unprivileged UID 10001.
  await chmod(directory, 0o755);
  const runtimeDirectory = join(directory, 'runtime'), nativeRoot = join(directory, 'native');
  const templates = (await getNativeTemplates(runtimeDirectory)).files;
  const native = await prepareNativeConfiguration(runtimeDirectory, settings, { root: nativeRoot });
  await saveNativeConfiguration(runtimeDirectory, native);
  for (const [name, template] of Object.entries(templates)) assert.equal(await readFile(join(nativeRoot, 'defaults', name), 'utf8'), template, `default ${name} retains exact source bytes`);
  // Edits outside the old generated subset must reach the real native loaders.
  const edits = {
    'core.yaml': ['yaml', [{ path: ['llm', 'stream'], value: true }, { path: ['metadata', 'maxUsersPerInstance'], value: 731 }]],
    'proxy.yaml': ['yaml', [{ path: ['server', 'forwardTimeoutMs'], value: 123456 }, { path: ['admin', 'apiKey'], value: `admin-${escaped}` }]],
    'knowledge.env': ['env', [{ path: ['LLM_STREAM'], value: 'true' }]],
    'panel.env': ['env', [{ path: ['METADATA_REMOTE_TIMEOUT_MS'], value: '23456' }]],
  };
  for (const [name, [format, changes]] of Object.entries(edits)) if (native.overrides[name] !== undefined) {
    const path = join(nativeRoot, 'overrides', name);
    await writeFile(path, updateNativeDocument(await readFile(path, 'utf8'), format, changes), { mode: 0o600 });
  }
  const documents = await readNativeDocuments(runtimeDirectory);
  for (const [name, value] of Object.entries({ ...nativeRuntimeConfigs(settings, documents), ...documents })) {
    await writeFile(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o644 });
  }
  await writeFile(join(directory, 'expected.json'), JSON.stringify({ ...normalizeNativeServiceConfigs(settings, documents), PROXY_ADMIN_KEY: proxyAdminKey(documents) }), { mode: 0o644 });
  const identity = execFileSync(engine, ['image', 'inspect', '--format', '{{.Id}}', `${imagePrefix}/${image}:local`], { encoding: 'utf8' }).trim();
  assert.match(identity, /^(?:sha256:)?[a-f0-9]{64}$/);
  t.diagnostic(`${image}: ${identity}`);
  const program = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    const expected = JSON.parse(readFileSync('/config/expected.json', 'utf8'));
    process.env.DO_NOT_EXPAND = 'incorrect-expansion';
    ${body}
    console.log('UPSTREAM_CONFIG_OK');
  `;
  const output = execFileSync(engine, [
    'run', '--rm', '-i', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
    '--mount', `type=bind,source=${directory},target=/config,readonly`,
    ...(image === 'core' ? ['-e', 'TDAI_GATEWAY_CONFIG=/config/core.yaml'] : []),
    ...(image === 'knowledge' || image === 'panel' ? ['--mount', `type=bind,source=${directory}/${image}.env,target=/app/.env,readonly`] : []),
    '--entrypoint', 'node', identity, ...imports,
    '--input-type=module', '-',
  ], { input: program, encoding: 'utf8', timeout: 45_000, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(output, /UPSTREAM_CONFIG_OK/);
}

test('Core image loads exact LLM credentials and standalone SQLite paths', { skip: !enabled }, async (t) => {
  await checkLoader(t, 'core', ['--import', 'tsx'], `
    const { loadGatewayConfig } = await import('/app/src/gateway/config.ts');
    const { loadStoreConfig } = await import('/app/src/metadata/store/factory.ts');
    const { applyMetadataEnvFromGatewayConfig } = await import('/app/src/gateway/metadata-env.ts');
    const config = loadGatewayConfig();
    assert.equal(config.deployMode, 'standalone');
    assert.equal(config.instanceId, 'ams');
    assert.equal(config.server.port, 8420);
    assert.equal(config.server.apiKey, expected.CORE_API_KEY);
    assert.equal(config.data.baseDir, '/data/memory');
    assert.equal(config.memory.storeBackend, 'sqlite');
    assert.equal(config.memory.embedding.enabled, false);
    assert.equal(config.memory.promptMode, expected.MEMORY_PROMPT_MODE);
    assert.equal(config.llm.stream, true);
    assert.equal(config.metadata.maxUsersPerInstance, 731);
    for (const llm of [config.llm, config.memory.llm]) {
      assert.equal(llm.apiKey, expected.LLM_API_KEY);
      assert.equal(llm.baseUrl, expected.LLM_BASE_URL);
      assert.equal(llm.model, expected.MEMORY_LLM_MODEL);
      assert.equal(llm.maxTokens, Number(expected.MEMORY_LLM_MAX_TOKENS));
      assert.equal(llm.timeoutMs, Number(expected.MEMORY_LLM_TIMEOUT_MS));
    }
    // The stock GatewayServer.start performs this native initialization before opening metadata.
    applyMetadataEnvFromGatewayConfig(config.metadata);
    const metadata = loadStoreConfig();
    assert.equal(metadata.backend, 'sqlite');
    assert.equal(metadata.sqliteBaseDir, '/data/metadata');
  `);
});

test('Knowledge image source loader receives exact direct-model settings', { skip: !enabled }, async (t) => {
  // Knowledge bundles server.mjs without exporting its config function. The stock Node runtime
  // loads the same shipped source module directly, with the image dependencies.
  await checkLoader(t, 'knowledge', [], `
    const { loadConfig } = await import('/app/src/config.ts');
    const config = loadConfig();
    assert.equal(config.port, 8421);
    assert.equal(config.dataDir, '/data');
    assert.equal(config.dbPath, '/data/knowledge.db');
    assert.equal(config.publicBaseUrl, expected.KNOWLEDGE_PUBLIC_URL + '/v3');
    assert.equal(config.llm.mode, 'custom');
    assert.equal(config.llm.protocol, 'openai');
    assert.equal(config.llm.apiKey, expected.LLM_API_KEY);
    assert.equal(config.llm.baseUrl, expected.LLM_BASE_URL);
    assert.equal(config.llm.model, expected.KNOWLEDGE_LLM_MODEL);
    assert.equal(config.llm.maxTokens, Number(expected.KNOWLEDGE_LLM_MAX_TOKENS));
    assert.equal(config.llm.timeoutMs, Number(expected.KNOWLEDGE_LLM_TIMEOUT_MS));
    assert.equal(config.llm.stream, true);
    assert.equal(config.clickhouse.enabled, false);
  `);
});

test('Proxy image builds its real YAML config without altering service credentials', { skip: !enabled }, async (t) => {
  await checkLoader(t, 'memory-proxy', ['--import', 'tsx/esm'], `
    const { buildConfig } = await import('/app/src/config.ts');
    const config = buildConfig({ configFile: '/config/proxy.yaml' });
    assert.equal(config.server.port, 8096);
    assert.equal(config.server.forwardTimeoutMs, 123456);
    assert.equal(config.admin.apiKey, expected.PROXY_ADMIN_KEY);
    assert.equal(config.upstream.url, 'http://cli-proxy-api:8317/v1');
    assert.equal(config.upstream.apiKey, expected.CLIPROXY_API_KEY);
    assert.equal(config.tdai.apiKey, expected.CORE_API_KEY);
    assert.equal(config.tdai.serviceId, 'ams');
    assert.equal(config.injection.externalGatewayUrl, expected.MEMORY_PROXY_PUBLIC_URL);
    assert.equal(config.auth.enabled, true);
    assert.equal(config.auth.url, 'http://core:8420');
    assert.equal(config.storage.enabled, true);
    assert.equal(config.storage.backend, 'sqlite');
    assert.equal(config.storage.sqlite.dbPath, '/data/proxy.db');
    assert.equal(config.redis.enabled, false);
    assert.deepEqual(config.rateLimit, { tpm: 0, qpm: 0 });
    assert.equal(config.creditReport.url, '');
    assert.deepEqual(config.creditPricing.models, []);
    assert.equal(process.env.AMS_KNOWLEDGE_URL, undefined);
  `);
});

test('Panel image loads registry and keeps Knowledge binding sync disabled', { skip: !enabled }, async (t) => {
  await checkLoader(t, 'panel', [], `
    const { loadPanelConfig } = await import('/app/dist/panel/config/panel-config.js');
    const { InstanceRegistry } = await import('/app/dist/panel/config/instance-registry.js');
    const config = loadPanelConfig();
    assert.equal(config.server.port, 8123);
    assert.equal(config.knowledge.baseUrl, 'http://knowledge:8421');
    assert.equal(config.knowledgeLlmBinding.sync, false);
    assert.equal(config.agentTemplateDir, '/data/templates');
    assert.equal(config.metadataRemoteTimeoutMs, 23456);
    assert.equal(config.clickhouse.enabled, false);
    const registry = InstanceRegistry.load(config.metadataInstancesConfig);
    const instance = registry.resolve('ams');
    assert.equal(instance.gateway_endpoint, 'http://core:8420');
    assert.equal(instance.api_key, expected.CORE_API_KEY);
    assert.equal(instance.proxy_endpoint, expected.MEMORY_PROXY_PUBLIC_URL);
    assert.equal(registry.listPublic()[0].api_key, undefined);
  `);
});

test('Core native loader retains stock whole-string placeholder interpolation', { skip: !enabled }, async t => {
  await checkLoader(t, 'core', ['--import', 'tsx'], `
    const { loadGatewayConfig } = await import('/app/src/gateway/config.ts');
    assert.equal(loadGatewayConfig().llm.apiKey, 'incorrect-expansion');
  `, resolveSettings({ ...settings, LLM_API_KEY: '${DO_NOT_EXPAND}' }));
});
