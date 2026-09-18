import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceNames, selectionFromEnv, resolveDeployment } from '../dist/deployment/model.js';
import { validateEnv } from '../dist/config/settings.js';
import { serviceConfigs } from '../dist/config/services.js';
import { generate } from '../dist/runtime/config.js';
import { encodeEnv, decodeEnv } from '../dist/config/files.js';

const configured = {
  CORE_API_KEY: 'local-core-key', CLIPROXY_API_KEY: 'local-model-key', LLM_BASE_URL: 'https://provider.test.invalid/v1', LLM_API_KEY: 'provider-key',
  MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model',
  REMOTE_CORE_URL: 'https://backend.invalid/memory', REMOTE_CORE_API_KEY: 'remote-core-key',
  REMOTE_MODEL_BASE_URL: 'https://models.invalid/api/v1', REMOTE_MODEL_API_KEY: 'remote-model-key',
  REMOTE_KNOWLEDGE_TOOLS_URL: 'https://knowledge-tools.invalid', REMOTE_KNOWLEDGE_URL: 'https://knowledge-service.invalid/private', REMOTE_PANEL_URL: 'https://panel-service.invalid/callbacks',
};
function settings(services, overrides = {}) {
  return { ...configured, AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: services.join(','), ...overrides };
}

test('all 63 non-empty selections resolve only selected applications and required helpers', () => {
  for (let mask = 1; mask < 2 ** serviceNames.length; mask++) {
    const selected = serviceNames.filter((_, index) => mask & (1 << index));
    const env = validateEnv(settings(selected));
    const plan = resolveDeployment(env);
    assert.deepEqual(plan.services, selected);
    assert.deepEqual(plan.requiredImages, [...selected, 'runtime']);
    assert.equal(plan.helpers.includes('bootstrap'), selected.includes('core'));
    assert.equal(plan.helpers.includes('access'), selected.includes('knowledge'));
    assert.equal(plan.helpers.includes('knowledge-service'), selected.includes('knowledge'));
    assert.equal('mcp.json' in serviceConfigs(env), selected.includes('mcp'));
    assert.equal('core.yaml' in serviceConfigs(env), selected.includes('core'));
    assert.equal('proxy.yaml' in serviceConfigs(env), selected.includes('memory-proxy'));
    assert.equal('knowledge-env.json' in serviceConfigs(env), selected.includes('knowledge'));
    assert.equal('panel-env.json' in serviceConfigs(env), selected.includes('panel'));
    assert.equal('cli-proxy-api.yaml' in serviceConfigs(env), selected.includes('cli-proxy-api'));
  }
});

test('selection metadata and conflicting modes reject instead of silently falling back', () => {
  assert.deepEqual(selectionFromEnv({}), [...serviceNames]);
  for (const input of [
    { AMS_DEPLOYMENT_VERSION: '2', AMS_SERVICES: 'core' }, { AMS_SERVICES: 'core' },
    { AMS_DEPLOYMENT_VERSION: '1' }, settings([]), settings(['unknown']), settings(['core', 'core']),
  ]) assert.throws(() => selectionFromEnv(input));
  assert.throws(() => resolveDeployment(settings(['memory-proxy'], { CORE_MODE: 'disabled' })), /CORE_MODE/);
  assert.throws(() => resolveDeployment(settings(['core'], { CORE_MODE: 'remote' })), /CORE_MODE/);
  assert.throws(() => resolveDeployment(settings(['memory-proxy'], { REMOTE_CORE_API_KEY: '' })), /REMOTE_CORE_API_KEY/);
  assert.doesNotThrow(() => resolveDeployment({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'memory-proxy' }, { requireConnections: false }));
});

test('standalone CLIProxyAPI consumes account settings without Core or internal LLM settings', () => {
  const env = validateEnv({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_API_KEY: 'local-token' });
  const plan = resolveDeployment(env);
  assert.deepEqual(plan.fields.sort(), ['CLIPROXY_API_KEY', 'CLIPROXY_AUTH_PROVIDER', 'CLIPROXY_SERVICE_ENABLED', 'DATA_DIR']);
  assert.deepEqual(plan.helpers, ['config']);
  assert.deepEqual(plan.interfaces, []);
  assert.deepEqual(Object.keys(serviceConfigs(env)), ['cli-proxy-api.yaml']);
});

test('inactive credentials survive remote replacement and local reselection without leaking into consumers', () => {
  const original = validateEnv(settings(serviceNames, { CORE_API_KEY: 'local-\'"\\$-key', LLM_API_KEY: 'local-provider' }));
  const preserved = { ...original };
  for (const name of Object.keys(preserved).filter(name => name.endsWith('_MODE'))) delete preserved[name];
  const remote = validateEnv({ ...preserved, AMS_SERVICES: 'memory-proxy', LLM_API_KEY: '', KNOWLEDGE_LLM_MODEL: '' });
  assert.equal(remote.CORE_API_KEY, original.CORE_API_KEY);
  assert.equal(remote.REMOTE_CORE_API_KEY, configured.REMOTE_CORE_API_KEY);
  assert.deepEqual(decodeEnv(encodeEnv(remote)), remote);
  const configs = serviceConfigs(remote);
  assert.equal(configs['proxy.yaml'].tdai.apiKey, configured.REMOTE_CORE_API_KEY);
  assert.equal(JSON.stringify(configs).includes(original.CORE_API_KEY), false);
  assert.equal(JSON.stringify(configs).includes('local-provider'), false);
  for (const name of Object.keys(remote).filter(name => name.endsWith('_MODE'))) delete remote[name];
  const reselected = validateEnv({ ...remote, AMS_SERVICES: 'core', LLM_API_KEY: 'local-provider' });
  assert.equal(serviceConfigs(reselected)['core-env.json'].TDAI_GATEWAY_API_KEY, original.CORE_API_KEY);
});

test('container service endpoints retain API prefixes separately from optional tool/browser origins', () => {
  const env = validateEnv(settings(['panel', 'memory-proxy'], {
    KNOWLEDGE_MODE: 'remote', KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true', KNOWLEDGE_PUBLIC_URL: 'https://tools.invalid', MEMORY_PROXY_PORT: '9096',
  }));
  const configs = serviceConfigs(env);
  assert.equal(env.MEMORY_PROXY_PUBLIC_URL, 'http://127.0.0.1:9096');
  assert.equal(configs['proxy.yaml'].auth.url, 'https://backend.invalid/memory');
  assert.equal(configs['proxy.yaml'].upstream.url, 'https://models.invalid/api/v1');
  assert.equal(configs['panel-env.json'].KNOWLEDGE_SERVICE_URL, 'https://knowledge-service.invalid/private');
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_URL, 'https://tools.invalid');
  assert.throws(() => validateEnv(settings(['panel'], { KNOWLEDGE_MODE: 'remote', KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' })), /KNOWLEDGE_PUBLIC_URL/);
  assert.throws(() => validateEnv(settings(['panel'], { REMOTE_CORE_URL: 'https://u:p@backend.invalid' })), /REMOTE_CORE_URL/);
  assert.throws(() => validateEnv(settings(['knowledge'], { REMOTE_PANEL_URL: '' })), /REMOTE_PANEL_URL/);
});

test('disabled integrations remove injectors and Panel proxy guidance while retaining memory and skills', () => {
  const configs = serviceConfigs(validateEnv(settings(['panel', 'memory-proxy'])));
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_ENABLED, 'false');
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_URL, '');
  assert.deepEqual(configs['proxy.yaml'].injection.injectors, ['skill', 'tdai-memory']);
  assert.equal(configs['proxy.yaml'].tdai.memory.enabled, true);
  const panelOnly = serviceConfigs(validateEnv(settings(['panel'])));
  assert.equal(panelOnly['panel-env.json'].AMS_KNOWLEDGE_ENABLED, 'false');
  assert.equal('proxy_endpoint' in panelOnly['panel-instances.json'].instances[0], false);
});

test('saved duplicate port preferences remain available for apply-time allocation', () => {
  const env = validateEnv(settings(['core'], { CORE_SERVICE_ENABLED: 'true', CORE_SERVICE_PORT: '9000', PANEL_PORT: '9000' }));
  assert.deepEqual(resolveDeployment(env).interfaces, [{ service: 'core', field: 'CORE_SERVICE_PORT', port: 9000, target: 8420, audience: 'service' }]);
  assert.deepEqual(resolveDeployment(validateEnv(settings(['core', 'panel'], { CORE_SERVICE_ENABLED: 'true', CORE_SERVICE_PORT: '8123' }))).interfaces.map(binding => binding.port), [8123, 8123]);
});

test('selected-only generation cleans obsolete generated secrets while retaining stored service data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-selection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '.env'), encodeEnv(validateEnv(settings(serviceNames))));
  await generate(directory);
  await writeFile(join(directory, 'data/core/preserved'), 'database marker');
  await writeFile(join(directory, '.env'), encodeEnv(validateEnv(settings(['cli-proxy-api']))));
  await generate(directory);
  assert.deepEqual(await readdir(join(directory, 'generated')), ['cli-proxy-api.yaml']);
  assert.equal(await readFile(join(directory, 'data/core/preserved'), 'utf8'), 'database marker');
});

test('Knowledge publication is opt-in while its internal gateway and normal features remain available', () => {
  const env = validateEnv(settings(serviceNames, { KNOWLEDGE_PORT: '18422', KNOWLEDGE_PUBLIC_URL: 'https://saved-tools.invalid' }));
  const deployment = resolveDeployment(env);
  assert.deepEqual(deployment.interfaces.map(binding => binding.service), ['memory-proxy', 'panel', 'mcp']);
  assert.ok(deployment.helpers.includes('access'));
  const configs = serviceConfigs(env);
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_ENABLED, 'true');
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_HTTP_ENABLED, 'false');
  assert.equal(configs['proxy-env.json'].AMS_KNOWLEDGE_URL, '');
  assert.equal(configs['panel-env.json'].AMS_KNOWLEDGE_ENABLED, 'true');
  assert.equal(configs['proxy.yaml'].tdai.memory.enabled, true);
  assert.ok(configs['proxy.yaml'].injection.injectors.includes('skill'));
  const exposed = validateEnv({ ...env, KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' });
  assert.ok(resolveDeployment(exposed).interfaces.some(binding => binding.service === 'access' && binding.port === 18422));
  assert.equal(serviceConfigs(exposed)['proxy-env.json'].AMS_KNOWLEDGE_HTTP_ENABLED, 'true');
  assert.equal(serviceConfigs(exposed)['proxy-env.json'].AMS_KNOWLEDGE_URL, 'https://saved-tools.invalid');
});


test('MCP defaults to an internal protected Knowledge dependency and never persists user credentials', () => {
  const env = validateEnv(settings(serviceNames));
  const plan = resolveDeployment(env);
  assert.equal(env.MCP_PORT, '8425');
  assert.deepEqual(plan.interfaces.find(item => item.service === 'mcp'), { service: 'mcp', field: 'MCP_PORT', port: 8425, target: 8425, audience: 'user' });
  assert.deepEqual(serviceConfigs(env)['mcp.json'], { port: 8425, coreUrl: 'http://core:8420', coreApiKey: configured.CORE_API_KEY, knowledgeToolsUrl: 'http://access:8080', serviceId: 'ams' });
  assert.ok(!plan.dataDirectories.includes('mcp'));
  assert.ok(!plan.interfaces.some(item => item.service === 'access'));
  assert.ok(plan.readiness.find(item => item.service === 'mcp').dependsOn.includes('access'));
  assert.equal(Object.keys(env).some(key => key.startsWith('KNOWLEDGETOOLS_')), false);
});

test('MCP alone requires explicit Core and protected tools endpoints without Panel or raw Knowledge', () => {
  const env = validateEnv(settings(['mcp'], { REMOTE_PANEL_URL: '', REMOTE_KNOWLEDGE_URL: '', LLM_API_KEY: '' }));
  const plan = resolveDeployment(env);
  assert.deepEqual(plan.helpers, ['config']);
  assert.deepEqual(Object.keys(serviceConfigs(env)), ['mcp.json']);
  assert.equal(serviceConfigs(env)['mcp.json'].knowledgeToolsUrl, configured.REMOTE_KNOWLEDGE_TOOLS_URL);
  for (const field of ['REMOTE_CORE_URL', 'REMOTE_CORE_API_KEY', 'REMOTE_KNOWLEDGE_TOOLS_URL']) {
    assert.throws(() => validateEnv(settings(['mcp'], { [field]: '' })), new RegExp(field));
  }
  assert.deepEqual(selectionFromEnv(settings(serviceNames.filter(service => service !== 'mcp'))), serviceNames.filter(service => service !== 'mcp'));
});
