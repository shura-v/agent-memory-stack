import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serviceConfigs } from '../dist/config/services.js';
import { validateEnv } from '../dist/config/settings.js';

// Opt in after building the images. All credentials are synthetic; containers
// have no network, publish no ports and execute only upstream configuration code.
const enabled = process.env.AMS_UPSTREAM_CONFIG_TEST === '1';
const engine = process.env.AMS_CONTAINER_ENGINE ?? 'podman';
const imagePrefix = process.env.AMS_TEST_IMAGE_PREFIX ?? 'agent-memory-stack';
const escaped = 'synthetic-\'"\\$value-${DO_NOT_EXPAND}-`';
const settings = validateEnv({
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
  for (const [name, value] of Object.entries(serviceConfigs(settings))) {
    await writeFile(join(directory, name), JSON.stringify(value), { mode: 0o644 });
  }
  await writeFile(join(directory, 'expected.json'), JSON.stringify(settings), { mode: 0o644 });
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
    '--entrypoint', 'node', identity,
    '--import', '/runtime/environment.mjs', ...imports,
    '--input-type=module', '-',
  ], { input: program, encoding: 'utf8', timeout: 45_000, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(output, /UPSTREAM_CONFIG_OK/);
}

test('Core image loads exact LLM credentials and standalone SQLite paths', { skip: !enabled }, async (t) => {
  await checkLoader(t, 'core', ['--import', 'tsx'], `
    const { loadGatewayConfig } = await import('/app/src/gateway/config.ts');
    const { loadStoreConfig } = await import('/app/src/metadata/store/factory.ts');
    const config = loadGatewayConfig();
    assert.equal(config.deployMode, 'standalone');
    assert.equal(config.instanceId, 'ams');
    assert.equal(config.server.port, 8420);
    assert.equal(config.server.apiKey, expected.CORE_API_KEY);
    assert.equal(config.data.baseDir, '/data/memory');
    assert.equal(config.memory.storeBackend, 'sqlite');
    assert.equal(config.memory.embedding.enabled, false);
    assert.equal(config.memory.promptMode, expected.MEMORY_PROMPT_MODE);
    for (const llm of [config.llm, config.memory.llm]) {
      assert.equal(llm.apiKey, expected.LLM_API_KEY);
      assert.equal(llm.baseUrl, expected.LLM_BASE_URL);
      assert.equal(llm.model, expected.MEMORY_LLM_MODEL);
      assert.equal(llm.maxTokens, Number(expected.MEMORY_LLM_MAX_TOKENS));
      assert.equal(llm.timeoutMs, Number(expected.MEMORY_LLM_TIMEOUT_MS));
    }
    const metadata = loadStoreConfig();
    assert.equal(metadata.backend, 'sqlite');
    assert.equal(metadata.sqliteBaseDir, '/data/metadata');
  `);
});

test('Knowledge image source loader receives exact direct-model settings', { skip: !enabled }, async (t) => {
  // Knowledge bundles server.mjs without exporting its config function. Node 24
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
    assert.equal(config.clickhouse.enabled, false);
  `);
});

test('Proxy image builds its real YAML config without altering service credentials', { skip: !enabled }, async (t) => {
  await checkLoader(t, 'memory-proxy', ['--import', 'tsx/esm'], `
    const { buildConfig } = await import('/app/src/config.ts');
    const config = buildConfig({ configFile: '/config/proxy.yaml' });
    assert.equal(config.server.port, 8096);
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
    assert.equal(process.env.AMS_KNOWLEDGE_URL, expected.KNOWLEDGE_PUBLIC_URL);
  `);
});

test('Panel image loads registry and keeps Knowledge binding sync disabled', { skip: !enabled }, async (t) => {
  await checkLoader(t, 'panel', [], `
    const { loadPanelConfig } = await import('/app/dist/panel/config/panel-config.js');
    const { InstanceRegistry } = await import('/app/dist/panel/config/instance-registry.js');
    const config = loadPanelConfig();
    assert.equal(config.server.port, 8123);
    assert.equal(config.knowledge.baseUrl, 'http://knowledge-service:8423');
    assert.equal(config.knowledgeLlmBinding.sync, false);
    assert.equal(config.agentTemplateDir, '/data/templates');
    const registry = InstanceRegistry.load(config.metadataInstancesConfig);
    const instance = registry.resolve('ams');
    assert.equal(instance.gateway_endpoint, 'http://core:8420');
    assert.equal(instance.api_key, expected.CORE_API_KEY);
    assert.equal(instance.proxy_endpoint, expected.MEMORY_PROXY_PUBLIC_URL);
    assert.equal(registry.listPublic()[0].api_key, undefined);
  `);
});

function subset(services, overrides = {}) {
  const env = { ...settings, AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: services.join(','), ...overrides };
  for (const name of ['CORE_MODE', 'MODEL_MODE', 'KNOWLEDGE_MODE', 'PANEL_MODE', 'PROXY_MODE']) delete env[name];
  return validateEnv(env);
}

test('Core-only loader accepts selected-only files and ignores inactive Knowledge settings', { skip: !enabled }, async t => {
  await checkLoader(t, 'core', ['--import', 'tsx'], `
    const { loadGatewayConfig } = await import('/app/src/gateway/config.ts');
    const config = loadGatewayConfig();
    assert.equal(config.llm.model, expected.MEMORY_LLM_MODEL);
    assert.equal(config.llm.apiKey, expected.LLM_API_KEY);
    assert.equal(config.server.apiKey, expected.CORE_API_KEY);
  `, subset(['core'], { KNOWLEDGE_LLM_MODEL: '', KNOWLEDGE_PUBLIC_URL: '' }));
});

test('Knowledge-only loader uses remote callback owner and selected direct model', { skip: !enabled }, async t => {
  await checkLoader(t, 'knowledge', [], `
    const { loadConfig } = await import('/app/src/config.ts');
    const config = loadConfig();
    assert.equal(config.llm.apiKey, expected.LLM_API_KEY);
    assert.equal(config.llm.model, expected.KNOWLEDGE_LLM_MODEL);
    assert.equal(process.env.TMC_CALLBACK_URL, expected.REMOTE_PANEL_URL);
    assert.equal(process.env.AMS_CORE_URL, expected.REMOTE_CORE_URL);
    assert.equal(process.env.AMS_CORE_API_KEY, expected.REMOTE_CORE_API_KEY);
  `, subset(['knowledge'], { REMOTE_CORE_URL: 'https://core.fixture.invalid/base', REMOTE_CORE_API_KEY: escaped, REMOTE_PANEL_URL: 'https://panel.fixture.invalid/base', MEMORY_LLM_MODEL: '' }));
});

test('Proxy-only loader preserves remote API prefixes, keys, and disabled Knowledge', { skip: !enabled }, async t => {
  await checkLoader(t, 'memory-proxy', ['--import', 'tsx/esm'], `
    const { buildConfig } = await import('/app/src/config.ts');
    const config = buildConfig({ configFile: '/config/proxy.yaml' });
    assert.equal(config.upstream.url, expected.REMOTE_MODEL_BASE_URL);
    assert.equal(config.upstream.apiKey, expected.REMOTE_MODEL_API_KEY);
    assert.equal(config.auth.url, expected.REMOTE_CORE_URL);
    assert.equal(config.tdai.apiKey, expected.REMOTE_CORE_API_KEY);
    assert.equal(config.knowledge.enabled, false);
    assert.deepEqual(config.injection.injectors, ['skill', 'tdai-memory']);
    assert.equal(process.env.AMS_KNOWLEDGE_ENABLED, 'false');
  `, subset(['memory-proxy'], { REMOTE_CORE_URL: 'https://core.fixture.invalid/base', REMOTE_CORE_API_KEY: escaped, REMOTE_MODEL_BASE_URL: 'https://model.fixture.invalid/api/v1', REMOTE_MODEL_API_KEY: escaped }));
});

test('Panel-only registry keeps remote Core credentials and omits absent proxy guidance', { skip: !enabled }, async t => {
  await checkLoader(t, 'panel', [], `
    const { loadPanelConfig } = await import('/app/dist/panel/config/panel-config.js');
    const { InstanceRegistry } = await import('/app/dist/panel/config/instance-registry.js');
    const config = loadPanelConfig();
    const instance = InstanceRegistry.load(config.metadataInstancesConfig).resolve('ams');
    assert.equal(instance.gateway_endpoint, expected.REMOTE_CORE_URL);
    assert.equal(instance.api_key, expected.REMOTE_CORE_API_KEY);
    assert.equal(instance.proxy_endpoint, undefined);
    assert.equal(process.env.AMS_KNOWLEDGE_ENABLED, 'false');
    assert.equal(process.env.KNOWLEDGE_AUTH_TOKEN, '');
  `, subset(['panel'], { REMOTE_CORE_URL: 'https://core.fixture.invalid/base', REMOTE_CORE_API_KEY: escaped }));
});
