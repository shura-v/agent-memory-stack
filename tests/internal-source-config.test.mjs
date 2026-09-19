import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettings, reviewSettings } from '../dist/config/settings.js';
import { internalModelSource, internalModelFields, internalLLM, usesLocalInternalModels } from '../dist/config/internal-llm.js';
import { seedNativeServiceConfigs } from '../dist/config/native-services.js';
import { nativeSourceFiles } from './fixtures/native-source.mjs';
import { parseNativeDocument } from '../dist/config/native-documents.js';
const templates = nativeSourceFiles;
function configs(env) {
  const documents = seedNativeServiceConfigs(env, templates);
  return { core: parseNativeDocument(documents['core.yaml'], 'yaml'), knowledge: parseNativeDocument(documents['knowledge.env'], 'env'), panel: parseNativeDocument(documents['panel.env'], 'env') };
}
import { resolveDeployment } from '../dist/deployment/model.js';

const settings = {
  CORE_API_KEY: 'core-secret', CLIPROXY_API_KEY: 'proxy-secret',
  LLM_BASE_URL: 'https://models.invalid/v1', LLM_API_KEY: 'external-secret',
  MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model',
};

test('default source settings preserve exact external credentials even when their endpoint matches CLIProxyAPI', () => {
  const env = resolveSettings({ ...settings, LLM_BASE_URL: 'http://cli-proxy-api:8317/v1' });
  assert.equal(internalModelSource({}), 'external');
  assert.equal(env.INTERNAL_LLM_SOURCE, 'external');
  assert.equal(usesLocalInternalModels(env), false);
  assert.deepEqual(internalLLM(env), { source: 'external', baseURL: env.LLM_BASE_URL, apiKey: 'external-secret' });
  assert.equal(configs(env).core.llm.apiKey, 'external-secret');
});

test('shared mode derives current proxy credentials for both consumers and preserves independent models and external settings', () => {
  const env = resolveSettings({ ...settings, INTERNAL_LLM_SOURCE: 'cliproxy' });
  const native = configs(env);
  assert.equal(native.core.llm.baseUrl, 'http://cli-proxy-api:8317/v1');
  assert.equal(native.knowledge.LLM_BASE_URL, 'http://cli-proxy-api:8317/v1');
  assert.equal(native.core.llm.apiKey, 'proxy-secret');
  assert.equal(native.knowledge.LLM_API_KEY, 'proxy-secret');
  assert.equal(native.core.llm.model, 'memory-model');
  assert.equal(native.knowledge.LLM_MODEL, 'knowledge-model');
  assert.equal(native.panel.KNOWLEDGE_LLM_BINDING_SYNC, 'false');
  assert.equal(env.LLM_API_KEY, settings.LLM_API_KEY);
  assert.equal(env.LLM_BASE_URL, settings.LLM_BASE_URL);
  const rotated = configs({ ...env, CLIPROXY_API_KEY: 'rotated-proxy-secret' });
  assert.equal(rotated.core.llm.apiKey, 'rotated-proxy-secret');
  assert.equal(rotated.knowledge.LLM_API_KEY, 'rotated-proxy-secret');
  assert.equal(configs({ ...env, INTERNAL_LLM_SOURCE: 'external' }).core.llm.apiKey, 'external-secret');
  const review = reviewSettings(env);
  assert.match(review, /Effective internal API base URL: http:\/\/cli-proxy-api:8317\/v1/);
  assert.doesNotMatch(review, /external-secret|proxy-secret|core-secret/);
});

test('shared internal models use both local consumers without adding a host listener', () => {
  const env = resolveSettings({ ...settings, INTERNAL_LLM_SOURCE: 'cliproxy' });
  assert.deepEqual(internalModelFields(), ['MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL']);
  const plan = resolveDeployment(env);
  for (const consumer of ['core', 'knowledge']) {
    assert.ok(plan.readiness.find(item => item.service === consumer).dependsOn.includes('cli-proxy-api'));
  }
  assert.equal(plan.interfaces.some(item => item.service === 'cli-proxy-api'), false);
});

test('native model choices and AMS choices are passed through without value checks', () => {
  const pending = { ...settings, INTERNAL_LLM_SOURCE: 'cliproxy', LLM_BASE_URL: '', LLM_API_KEY: '', MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' };
  const env = resolveSettings(pending);
  assert.equal(env.MEMORY_LLM_MODEL, '');
  assert.equal(env.KNOWLEDGE_LLM_MODEL, '');
  assert.doesNotThrow(() => resolveSettings(env));
  assert.doesNotThrow(() => configs(env));
  assert.match(reviewSettings(env), /MEMORY_LLM_MODEL: $/m);
  assert.doesNotMatch(reviewSettings(env), /select after/);
  for (const overrides of [
    { INTERNAL_LLM_SOURCE: 'unknown' }, { CLIPROXY_API_KEY: '' },
  ]) assert.doesNotThrow(() => resolveSettings({ ...pending, ...overrides }));
  assert.doesNotThrow(() => resolveSettings({ ...pending, MEMORY_LLM_MODEL: 'chosen-memory', KNOWLEDGE_LLM_MODEL: 'chosen-knowledge' }));
});

test('inactive external fields are retained without validating or using them in shared mode', () => {
  const env = resolveSettings({ ...settings, INTERNAL_LLM_SOURCE: 'cliproxy', LLM_BASE_URL: 'an unfinished endpoint', LLM_API_KEY: '' });
  assert.equal(env.LLM_BASE_URL, 'an unfinished endpoint');
  assert.equal(configs(env).core.llm.baseUrl, 'http://cli-proxy-api:8317/v1');
  assert.doesNotThrow(() => resolveSettings({ ...env, INTERNAL_LLM_SOURCE: 'external' }));
});


test('unknown model source values remain visible and do not select the local provider', () => {
  const env = resolveSettings({ ...settings, INTERNAL_LLM_SOURCE: 'operator-source' });
  assert.equal(internalModelSource(env), 'operator-source');
  assert.equal(internalLLM(env).source, 'operator-source');
  assert.equal(usesLocalInternalModels(env), false);
});

test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access in native unit test'); }));
