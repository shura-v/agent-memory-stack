import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serviceNames, resolveDeployment } from '../dist/deployment/model.js';
import { resolveSettings } from '../dist/config/settings.js';
import { mcpConfig } from '../dist/config/services.js';
import { generate } from '../dist/runtime/config.js';
import { composeDocument } from '../dist/runtime/render-compose.js';
import { encodeEnv } from '../dist/config/files.js';

const configured = {
  CORE_API_KEY: 'local-core-key', CLIPROXY_API_KEY: 'local-model-key', LLM_BASE_URL: 'https://provider.test.invalid/v1', LLM_API_KEY: 'provider-key',
  MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model',

};
function settings(overrides = {}) { return { ...configured, ...overrides }; }

test('every installation includes the full stack, helpers, images and native configuration', () => {
  for (const INTERNAL_LLM_SOURCE of ['external', 'cliproxy']) {
    const env = resolveSettings(settings({ INTERNAL_LLM_SOURCE }));
    const plan = resolveDeployment(env);
    assert.deepEqual(plan.services, [...serviceNames]);
    assert.deepEqual(plan.requiredImages, [...serviceNames, 'runtime']);
    assert.deepEqual(plan.helpers, ['config', 'bootstrap', 'access']);
    assert.equal(plan.connections.core.endpoint, 'http://core:8420');
    assert.equal(plan.connections.model.endpoint, 'http://cli-proxy-api:8317/v1');
    assert.equal(plan.connections.knowledge.endpoint, 'http://knowledge:8421');
    assert.equal(plan.connections.panel.endpoint, 'http://panel:8123');
  }
});

test('unconsumed settings do not change the fixed full stack', () => {
  for (const name of ['AMS_DEPLOYMENT_VERSION', 'AMS_SERVICES', 'CORE_MODE', 'MODEL_MODE', 'KNOWLEDGE_MODE', 'PANEL_MODE', 'PROXY_MODE',
    'REMOTE_CORE_URL', 'REMOTE_CORE_API_KEY', 'REMOTE_MODEL_BASE_URL', 'REMOTE_MODEL_API_KEY', 'REMOTE_KNOWLEDGE_URL', 'REMOTE_KNOWLEDGE_TOOLS_URL', 'REMOTE_PANEL_URL']) {
    assert.deepEqual(resolveDeployment(resolveSettings(settings({ [name]: 'arbitrary-value' }))).services, [...serviceNames]);
  }
});

test('saved duplicate port preferences remain available for apply-time allocation', () => {
  const env = resolveSettings(settings({ CORE_SERVICE_ENABLED: 'true', CORE_SERVICE_PORT: '9000', PANEL_PORT: '9000' }));
  assert.deepEqual(resolveDeployment(env).interfaces.filter(binding => binding.port === 9000).map(binding => binding.service), ['panel', 'core']);
});

test('direct whole-stack generation requires a staged native snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-unstaged-tdai-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '.env'), encodeEnv(resolveSettings(settings())));
  await assert.rejects(generate(directory), /native.*snapshot|staged.*native|ams apply/i);
  await assert.rejects(readdir(join(directory, 'generated')), { code: 'ENOENT' });
});

test('Knowledge publication is opt-in while its internal gateway and normal features remain available', () => {
  const env = resolveSettings(settings({ KNOWLEDGE_PORT: '18422', KNOWLEDGE_PUBLIC_URL: 'https://saved-tools.invalid' }));
  const deployment = resolveDeployment(env);
  assert.deepEqual(deployment.interfaces.map(binding => binding.service), ['memory-proxy', 'panel', 'mcp']);
  assert.ok(deployment.helpers.includes('access'));
  const exposed = resolveSettings({ ...env, KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' });
  assert.ok(resolveDeployment(exposed).interfaces.some(binding => binding.service === 'access' && binding.port === 18422));
});


test('MCP defaults to an internal protected Knowledge dependency and never persists user credentials', () => {
  const env = resolveSettings(settings());
  const plan = resolveDeployment(env);
  assert.equal(env.MCP_PORT, '8425');
  assert.deepEqual(plan.interfaces.find(item => item.service === 'mcp'), { service: 'mcp', field: 'MCP_PORT', port: 8425, target: 8425, audience: 'user' });
  assert.deepEqual(mcpConfig(env), { port: 8425, coreUrl: 'http://core:8420', coreApiKey: configured.CORE_API_KEY, knowledgeToolsUrl: 'http://access:8080', serviceId: 'ams' });
  assert.ok(!plan.dataDirectories.includes('mcp'));
  assert.ok(!plan.interfaces.some(item => item.service === 'access'));
  assert.ok(plan.readiness.find(item => item.service === 'mcp').dependsOn.includes('access'));
  assert.equal(Object.keys(env).some(key => key.startsWith('KNOWLEDGETOOLS_')), false);
});


test('TDAI containers receive only native configuration mounts and native loader selection', () => {
  const generation = '12345678-1234-1234-1234-123456789abc';
  const document = composeDocument(resolveSettings(configured), { generation, root: '/operator/native' });
  const file = name => `./.ams/generations/${generation}/${name}`;
  assert.deepEqual(document.services.core.environment, { TDAI_GATEWAY_CONFIG: '/config/core.yaml' });
  assert.ok(document.services.core.volumes.includes(`${file('core.yaml')}:/config/core.yaml:ro`));
  assert.ok(document.services['memory-proxy'].volumes.includes(`${file('proxy.yaml')}:/config/proxy.yaml:ro`));
  assert.ok(document.services.knowledge.volumes.includes(`${file('knowledge.env')}:/app/.env:ro`));
  assert.ok(document.services.panel.volumes.includes(`${file('panel.env')}:/app/.env:ro`));
  assert.ok(document.services.panel.volumes.includes(`${file('panel-instances.json')}:/config/panel-instances.json:ro`));
  for (const name of ['core', 'knowledge', 'panel', 'memory-proxy']) {
    assert.doesNotMatch(JSON.stringify(document.services[name]), /AMS_ENV_FILE|environment\.mjs|identity|(?:core|knowledge|panel|proxy)-env\.json/);
  }
  assert.equal(document.services['knowledge-service'], undefined);
});
