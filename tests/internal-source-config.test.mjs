import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, reviewSettings } from '../dist/config/settings.js';
import { internalModelSource, internalModelFields, internalLLM, usesLocalInternalModels } from '../dist/config/internal-llm.js';
import { serviceConfigs } from '../dist/config/services.js';
import { resolveDeployment } from '../dist/deployment/model.js';

const settings = {
  CORE_API_KEY: 'core-secret', CLIPROXY_API_KEY: 'proxy-secret',
  LLM_BASE_URL: 'https://models.invalid/v1', LLM_API_KEY: 'external-secret',
  MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model',
};
const placement = (services, overrides = {}) => ({ ...settings, AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: services, ...overrides });

test('legacy settings preserve exact external credentials even when their endpoint matches CLIProxyAPI', () => {
  const env = validateEnv({ ...settings, LLM_BASE_URL: 'http://cli-proxy-api:8317/v1' });
  assert.equal(internalModelSource({}), 'external');
  assert.equal(env.INTERNAL_LLM_SOURCE, 'external');
  assert.equal(usesLocalInternalModels(env), false);
  assert.deepEqual(internalLLM(env), { source: 'external', baseURL: env.LLM_BASE_URL, apiKey: 'external-secret' });
  assert.equal(serviceConfigs(env)['core-env.json'].TDAI_LLM_API_KEY, 'external-secret');
});

test('shared mode derives current proxy credentials for both consumers and preserves independent models and external settings', () => {
  const env = validateEnv({ ...settings, INTERNAL_LLM_SOURCE: 'cliproxy' });
  const configs = serviceConfigs(env);
  assert.equal(configs['core-env.json'].TDAI_LLM_BASE_URL, 'http://cli-proxy-api:8317/v1');
  assert.equal(configs['knowledge-env.json'].LLM_BASE_URL, 'http://cli-proxy-api:8317/v1');
  assert.equal(configs['core-env.json'].TDAI_LLM_API_KEY, 'proxy-secret');
  assert.equal(configs['knowledge-env.json'].LLM_API_KEY, 'proxy-secret');
  assert.equal(configs['core-env.json'].TDAI_LLM_MODEL, 'memory-model');
  assert.equal(configs['knowledge-env.json'].LLM_MODEL, 'knowledge-model');
  assert.equal(configs['panel-env.json'].KNOWLEDGE_LLM_BINDING_SYNC, 'false');
  assert.equal(env.LLM_API_KEY, settings.LLM_API_KEY);
  assert.equal(env.LLM_BASE_URL, settings.LLM_BASE_URL);
  const rotated = serviceConfigs({ ...env, CLIPROXY_API_KEY: 'rotated-proxy-secret' });
  assert.equal(rotated['core-env.json'].TDAI_LLM_API_KEY, 'rotated-proxy-secret');
  assert.equal(rotated['knowledge-env.json'].LLM_API_KEY, 'rotated-proxy-secret');
  assert.equal(serviceConfigs({ ...env, INTERNAL_LLM_SOURCE: 'external' })['core-env.json'].TDAI_LLM_API_KEY, 'external-secret');
  const review = reviewSettings(env);
  assert.match(review, /Effective internal API base URL: http:\/\/cli-proxy-api:8317\/v1/);
  assert.doesNotMatch(review, /external-secret|proxy-secret|core-secret/);
});

test('local internal consumers require local CLIProxyAPI without adding services or host listeners', () => {
  for (const consumer of ['core', 'knowledge']) {
    assert.throws(() => validateEnv(placement(consumer, { INTERNAL_LLM_SOURCE: 'cliproxy' })), /INTERNAL_LLM_SOURCE=cliproxy requires cli-proxy-api/);
    const env = validateEnv(placement(`${consumer},cli-proxy-api`, { INTERNAL_LLM_SOURCE: 'cliproxy',
      REMOTE_CORE_URL: 'http://remote-core.invalid', REMOTE_CORE_API_KEY: 'remote-core-secret', REMOTE_PANEL_URL: 'http://remote-panel.invalid',
    }));
    assert.deepEqual(internalModelFields(env), [consumer === 'core' ? 'MEMORY_LLM_MODEL' : 'KNOWLEDGE_LLM_MODEL']);
    const plan = resolveDeployment(env);
    assert.ok(plan.readiness.find(item => item.service === consumer).dependsOn.includes('cli-proxy-api'));
    assert.equal(plan.interfaces.some(item => item.service === 'cli-proxy-api'), false);
  }
  const noConsumers = validateEnv(placement('cli-proxy-api', { INTERNAL_LLM_SOURCE: 'cliproxy', LLM_API_KEY: '', MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  assert.equal(usesLocalInternalModels(noConsumers), false);
  assert.deepEqual(internalModelFields(noConsumers), []);
  assert.deepEqual(Object.keys(serviceConfigs(noConsumers)), ['cli-proxy-api.yaml']);
});

test('only missing local model choices can be deferred and full consumer configuration rejects them', () => {
  const pending = { ...settings, INTERNAL_LLM_SOURCE: 'cliproxy', LLM_BASE_URL: '', LLM_API_KEY: '', MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' };
  const env = validateEnv(pending, { allowPendingModels: true });
  assert.equal(env.MEMORY_LLM_MODEL, '');
  assert.equal(env.KNOWLEDGE_LLM_MODEL, '');
  assert.throws(() => validateEnv(env), /MEMORY_LLM_MODEL, KNOWLEDGE_LLM_MODEL/);
  assert.throws(() => serviceConfigs(env), /MEMORY_LLM_MODEL, KNOWLEDGE_LLM_MODEL/);
  assert.match(reviewSettings(env), /MEMORY_LLM_MODEL: \[select after CLIProxyAPI authorization\]/);
  for (const overrides of [
    { INTERNAL_LLM_SOURCE: 'external' }, { INTERNAL_LLM_SOURCE: 'unknown' }, { CLIPROXY_API_KEY: '' },
    { MEMORY_LLM_MODEL: ' ' }, { MEMORY_LLM_MODEL: '<model>' },
  ]) assert.throws(() => validateEnv({ ...pending, ...overrides }, { allowPendingModels: true }));
  assert.doesNotThrow(() => validateEnv({ ...pending, MEMORY_LLM_MODEL: 'chosen-memory', KNOWLEDGE_LLM_MODEL: 'chosen-knowledge' }));
});

test('inactive external fields are retained without validating or using them in shared mode', () => {
  const env = validateEnv({ ...settings, INTERNAL_LLM_SOURCE: 'cliproxy', LLM_BASE_URL: 'an unfinished endpoint', LLM_API_KEY: '' });
  assert.equal(env.LLM_BASE_URL, 'an unfinished endpoint');
  assert.equal(serviceConfigs(env)['core-env.json'].TDAI_LLM_BASE_URL, 'http://cli-proxy-api:8317/v1');
  assert.throws(() => validateEnv({ ...env, INTERNAL_LLM_SOURCE: 'external' }), /LLM_BASE_URL, LLM_API_KEY/);
});
