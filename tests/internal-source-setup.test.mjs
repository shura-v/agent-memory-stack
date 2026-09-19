import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serverQuestions } from '../dist/setup/questions.js';
import { setupServer, applyServer } from '../dist/setup/server.js';
import { readEnv, encodeEnv, decodeEnv } from '../dist/config/files.js';
import { validateEnv } from '../dist/config/settings.js';
import { serviceNames } from '../dist/deployment/model.js';
import { Back, Cancelled } from '../dist/setup/interaction.js';
import { navigate } from '../dist/setup/navigation.js';
import { InternalModelAccessError } from '../dist/runtime/model-discovery.js';
import { snapshotSettings } from '../dist/runtime/snapshot.js';

const external = { LLM_BASE_URL: 'https://models.invalid/v1', LLM_API_KEY: 'external-key',
  CORE_API_KEY: 'core-key', CLIPROXY_API_KEY: 'proxy-key', MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model' };
const local = (overrides = {}) => validateEnv({ ...external, INTERNAL_LLM_SOURCE: 'cliproxy', ...overrides }, { allowPendingModels: true });
const manifest = { schemaVersion: 1, images: Object.fromEntries([...serviceNames, 'runtime'].map((service, index) =>
  [service, { id: `sha256:${String(index + 1).repeat(64)}`, tag: `${service}:test`, platform: 'linux/arm64', repoDigests: [] }])) };
const noModels = async () => [];

function interaction(answers = {}, events = []) {
  const asked = [], notes = [], questions = [];
  const resolveAnswer = async (id, fallback) => typeof answers[id] === 'function' ? answers[id]() : answers[id] ?? fallback;
  return { asked, notes, questions,
    async text(q) {
      asked.push(q.id); questions.push(q); events.push(`question:${q.id}`);
      const value = await resolveAnswer(q.id, q.initial ?? external[q.id]);
      assert.equal(typeof value, 'string', q.id);
      assert.equal(q.validate?.(value), undefined, q.id);
      return value;
    },
    async select(id, message, choices, initial) {
      asked.push(id); questions.push({ id, message, choices, initial }); events.push(`question:${id}`);
      return resolveAnswer(id, initial ?? choices[0].value);
    },
    async confirm(id, _message, initial) { asked.push(id); return resolveAnswer(id, initial); },
    async multiselect(_id, _message, _choices, initial) { return initial; },
    note(message) { notes.push(message); }, print() {}, handoff: async () => {}, commit() {},
  };
}
async function fixture(t, env = local()) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-internal-models-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.ams'));
  await writeFile(join(directory, '.env'), encodeEnv(env));
  await writeFile(join(directory, '.ams/runtime.json'), JSON.stringify({ provider: 'docker' }));
  return directory;
}
function runtime(events, overrides = {}) {
  return {
    preflight: async () => { events.push('preflight'); },
    prepareInternalProxy: async () => { events.push('proxy'); },
    hasProviderAuthorization: async () => { events.push('authorized'); return true; },
    discoverInternalModels: async () => { events.push('discovery'); return ['model-a', 'model-b']; },
    apply: async () => { events.push('apply'); },
    login: async () => { events.push('login'); },
    ...overrides,
  };
}
function options(value) {
  return { runtime: () => value, prepareImages: async () => structuredClone(manifest), listModels: noModels };
}

test('fresh eligible setup defaults to shared CLIProxyAPI and defers both models without external API questions', async () => {
  const ui = interaction();
  const env = await serverQuestions(ui, {}, serviceNames, { listModels: () => assert.fail('local discovery belongs to Apply') });
  const source = ui.questions.find(q => q.id === 'INTERNAL_LLM_SOURCE');
  assert.deepEqual(ui.asked.slice(0, 2), ['CLIPROXY_AUTH_PROVIDER', 'INTERNAL_LLM_SOURCE']);
  assert.equal(ui.asked.filter(id => id === 'CLIPROXY_AUTH_PROVIDER').length, 1);
  assert.equal(source.initial, 'cliproxy');
  assert.deepEqual(source.choices.map(choice => choice.value), ['cliproxy', 'external']);
  assert.equal(env.INTERNAL_LLM_SOURCE, 'cliproxy');
  for (const field of ['LLM_BASE_URL', 'LLM_API_KEY', 'MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL']) assert.ok(!ui.asked.includes(field), field);
  assert.ok(!env.MEMORY_LLM_MODEL); assert.ok(!env.KNOWLEDGE_LLM_MODEL);
});

test('legacy settings stay external and opting into shared mode preserves their API credentials', async () => {
  const legacyUI = interaction();
  const legacy = await serverQuestions(legacyUI, external, serviceNames, { listModels: noModels });
  assert.equal(legacy.INTERNAL_LLM_SOURCE, 'external');
  assert.equal(legacyUI.questions.find(q => q.id === 'INTERNAL_LLM_SOURCE').initial, 'external');
  assert.ok(legacyUI.asked.includes('LLM_BASE_URL'));
  const sharedUI = interaction({ INTERNAL_LLM_SOURCE: 'cliproxy' });
  const shared = await serverQuestions(sharedUI, external, serviceNames, { listModels: () => assert.fail('local mode') });
  assert.equal(shared.LLM_BASE_URL, external.LLM_BASE_URL);
  assert.equal(shared.LLM_API_KEY, external.LLM_API_KEY);
  assert.equal(shared.CORE_API_KEY, external.CORE_API_KEY);
  assert.equal(shared.CLIPROXY_API_KEY, external.CLIPROXY_API_KEY);
  assert.equal(shared.MEMORY_LLM_MODEL, external.MEMORY_LLM_MODEL);
});

test('Core-only and Knowledge-only consumers retain separate deferred model fields with a local proxy', async () => {
  for (const consumer of ['core', 'knowledge']) {
    const existing = { INTERNAL_LLM_SOURCE: 'cliproxy',
      REMOTE_CORE_URL: 'https://core.invalid', REMOTE_CORE_API_KEY: 'remote-core-key', REMOTE_PANEL_URL: 'https://panel.invalid' };
    const ui = interaction();
    const env = await serverQuestions(ui, existing, [consumer, 'cli-proxy-api'], { listModels: () => assert.fail('local mode') });
    assert.equal(env.INTERNAL_LLM_SOURCE, 'cliproxy');
    assert.equal(env.AMS_SERVICES, `${consumer},cli-proxy-api`);
    assert.ok(!ui.asked.includes('MEMORY_LLM_MODEL'));
    assert.ok(!ui.asked.includes('KNOWLEDGE_LLM_MODEL'));
  }
  const ui = interaction();
  const env = await serverQuestions(ui, {}, ['cli-proxy-api'], { listModels: () => assert.fail('no consumers') });
  assert.equal(env.AMS_SERVICES, 'cli-proxy-api');
  for (const name of ['INTERNAL_LLM_SOURCE', 'LLM_BASE_URL', 'LLM_API_KEY', 'MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL']) assert.ok(!ui.asked.includes(name), name);
});

test('fresh save-only setup stores pending local models without engine access or image preparation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-internal-save-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ui = interaction({ apply: false });
  await setupServer(ui, { directory, listModels: () => assert.fail('no external discovery'),
    prepareImages: () => assert.fail('save-only'), runtime: () => assert.fail('save-only') });
  const saved = await readEnv(join(directory, '.env'));
  assert.equal(saved.INTERNAL_LLM_SOURCE, 'cliproxy');
  assert.ok(!saved.MEMORY_LLM_MODEL); assert.ok(!saved.KNOWLEDGE_LLM_MODEL);
  assert.match(ui.notes.join('\n'), /after.*authorization/i);
});

test('back navigation changes the model source without rotating generated service keys or retaining external model choices', async () => {
  const ui = interaction({ INTERNAL_LLM_SOURCE: 'external' });
  const originalText = ui.text, originalSelect = ui.select;
  let returning = false, switched = false, first, discoveries = 0;
  ui.text = async question => {
    if (returning) throw new Back();
    return originalText(question);
  };
  ui.select = async (id, ...args) => {
    if (returning) {
      if (id !== 'INTERNAL_LLM_SOURCE') throw new Back();
      returning = false; switched = true; return 'cliproxy';
    }
    return originalSelect(id, ...args);
  };
  ui.confirm = async id => {
    assert.equal(id, 'finish-review');
    if (!switched) { returning = true; throw new Back(); }
    return true;
  };
  const final = await navigate(ui, async questions => {
    const env = await serverQuestions(questions, {}, serviceNames, { listModels: async () => { discoveries++; return ['external-model']; } });
    if (!first) first = env;
    await questions.confirm('finish-review', 'Finish review?');
    return env;
  });
  assert.equal(first.INTERNAL_LLM_SOURCE, 'external');
  assert.equal(final.INTERNAL_LLM_SOURCE, 'cliproxy');
  assert.equal(final.CORE_API_KEY, first.CORE_API_KEY);
  assert.equal(final.CLIPROXY_API_KEY, first.CLIPROXY_API_KEY);
  assert.ok(!final.MEMORY_LLM_MODEL); assert.ok(!final.KNOWLEDGE_LLM_MODEL);
  assert.equal(discoveries, 1);
});

test('immediate fresh setup chooses the provider once and authorizes it before model selection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-internal-immediate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [];
  const ui = interaction({ apply: true, CLIPROXY_AUTH_PROVIDER: 'claude', MEMORY_LLM_MODEL: 'model:0', KNOWLEDGE_LLM_MODEL: 'model:1' }, events);
  let authorized = false;
  const engine = runtime(events, {
    prepareInternalProxy: async () => {
      const saved = await readEnv(join(directory, '.env'));
      assert.equal(saved.INTERNAL_LLM_SOURCE, 'cliproxy');
      assert.equal(saved.CLIPROXY_AUTH_PROVIDER, 'claude');
      if (!authorized) { assert.ok(!saved.MEMORY_LLM_MODEL); assert.ok(!saved.KNOWLEDGE_LLM_MODEL); }
      events.push('proxy');
    },
    hasProviderAuthorization: async provider => { assert.equal(provider, 'claude'); return authorized; },
    login: async provider => { assert.equal(provider, 'claude'); events.push('login'); authorized = true; },
    apply: async (_key, { createAdminKey }) => {
      assert.equal(authorized, true);
      assert.equal(typeof createAdminKey, 'function');
      const saved = await readEnv(join(directory, '.env'));
      assert.equal(saved.MEMORY_LLM_MODEL, 'model-a'); assert.equal(saved.KNOWLEDGE_LLM_MODEL, 'model-b');
      events.push('apply');
    },
  });
  await setupServer(ui, { ...options(engine), directory });
  assert.ok(events.indexOf('proxy') < events.indexOf('login'));
  assert.ok(events.indexOf('login') < events.indexOf('question:MEMORY_LLM_MODEL'));
  assert.ok(events.indexOf('question:KNOWLEDGE_LLM_MODEL') < events.indexOf('apply'));
  assert.equal(events.filter(event => event === 'apply').length, 1);
  assert.equal(ui.asked.filter(id => id === 'CLIPROXY_AUTH_PROVIDER').length, 1);
  assert.ok(!ui.asked.includes('login'));
  assert.ok(!ui.asked.includes('LLM_BASE_URL')); assert.ok(!ui.asked.includes('LLM_API_KEY'));
  const repeated = interaction();
  await applyServer(repeated, directory, options(engine));
  assert.equal(events.filter(event => event === 'login').length, 1);
  assert.deepEqual(repeated.asked, []);
});

test('Apply authorizes the proxy before discovery and persists each chosen model before starting consumers', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  const events = [];
  let authorized = false;
  const ui = interaction({ MEMORY_LLM_MODEL: 'model:0', KNOWLEDGE_LLM_MODEL: async () => {
    assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, 'model-a'); return 'model:1';
  } }, events);
  const engine = runtime(events, {
    hasProviderAuthorization: async () => authorized,
    login: async () => { events.push('login'); authorized = true; },
    discoverInternalModels: async () => { assert.equal(authorized, true); events.push('discovery'); return ['model-a', 'model-b']; },
    apply: async () => {
      const saved = await readEnv(join(directory, '.env'));
      assert.equal(saved.MEMORY_LLM_MODEL, 'model-a'); assert.equal(saved.KNOWLEDGE_LLM_MODEL, 'model-b'); events.push('apply');
    },
  });
  await applyServer(ui, directory, options(engine));
  for (const [before, after] of [['proxy', 'login'], ['login', 'discovery'], ['discovery', 'question:MEMORY_LLM_MODEL'], ['question:KNOWLEDGE_LLM_MODEL', 'apply']]) {
    assert.ok(events.indexOf(before) < events.indexOf(after), `${before} before ${after}: ${events}`);
  }
  assert.equal(events.filter(event => event === 'login').length, 1);
  const baseline = decodeEnv(JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'))['.env']);
  assert.equal(baseline.MEMORY_LLM_MODEL, 'model-a'); assert.equal(baseline.KNOWLEDGE_LLM_MODEL, 'model-b');
});

test('cancelling the second model keeps the first and resumes only the remaining question', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  const engine = runtime([], { apply: async () => assert.fail('cancelled before consumer startup') });
  const ui = interaction({ MEMORY_LLM_MODEL: 'model:0', KNOWLEDGE_LLM_MODEL: () => { throw new Cancelled(); } });
  await assert.rejects(applyServer(ui, directory, options(engine)), Cancelled);
  const saved = await readEnv(join(directory, '.env'));
  assert.equal(saved.MEMORY_LLM_MODEL, 'model-a'); assert.equal(saved.KNOWLEDGE_LLM_MODEL, '');
  const resumed = interaction({ KNOWLEDGE_LLM_MODEL: 'model:1' });
  await applyServer(resumed, directory, options(runtime([])));
  assert.ok(!resumed.asked.includes('MEMORY_LLM_MODEL'));
  assert.equal((await readEnv(join(directory, '.env'))).KNOWLEDGE_LLM_MODEL, 'model-b');
});

test('complete saved models skip discovery and selection even when not listed by the account', async t => {
  const directory = await fixture(t);
  const ui = interaction();
  await applyServer(ui, directory, options(runtime([], { discoverInternalModels: () => assert.fail('models already saved') })));
  assert.ok(!ui.asked.includes('MEMORY_LLM_MODEL'));
  assert.ok(!ui.asked.includes('KNOWLEDGE_LLM_MODEL'));
  assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, 'memory-model');
});

test('unavailable discovery permits manual model input while proxy authentication errors stay visible', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  const ui = interaction({ MEMORY_LLM_MODEL: 'manual-memory', KNOWLEDGE_LLM_MODEL: 'manual-knowledge' });
  await applyServer(ui, directory, options(runtime([], { discoverInternalModels: async () => [] })));
  assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, 'manual-memory');
  for (const status of [401, 403]) {
    const failed = await fixture(t, local({ MEMORY_LLM_MODEL: '' }));
    const rejectedUI = interaction();
    await assert.rejects(applyServer(rejectedUI, failed, options(runtime([], {
      discoverInternalModels: async () => { throw new InternalModelAccessError(status); },
      apply: () => assert.fail('authorization failed'),
    }))), error => error.message.includes(`HTTP ${status}`) && error.message.includes('CLIProxyAPI'));
    assert.ok(!rejectedUI.asked.includes('LLM_API_KEY'));
    assert.ok(!rejectedUI.asked.includes('MEMORY_LLM_MODEL'));
  }
});

test('noninteractive Apply with missing local models names the fields instead of prompting', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  const ui = interaction(); ui.interactive = false;
  await assert.rejects(applyServer(ui, directory, options(runtime([], { apply: () => assert.fail('pending models') }))),
    error => error.message.includes('MEMORY_LLM_MODEL') && error.message.includes('KNOWLEDGE_LLM_MODEL'));
  assert.deepEqual(ui.asked, []);
});

test('configured provider and successful model choices become the baseline; failed consumer apply preserves the previous baseline', async t => {
  for (const fail of [false, true]) {
    const directory = await fixture(t, local({ CLIPROXY_AUTH_PROVIDER: 'claude', MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
    const previous = { '.env': encodeEnv(validateEnv(external)), '.ams/runtime.json': null, '.ams/network.json': null, '.ams/tdai-source.json': null };
    await writeFile(join(directory, '.ams/last-applied-inputs.json'), JSON.stringify(previous));
    let authorized = false;
    const engine = runtime([], {
      snapshot: async () => snapshotSettings(directory),
      hasProviderAuthorization: async provider => provider === 'claude' && authorized,
      login: async provider => { assert.equal(provider, 'claude'); authorized = true; },
      apply: async () => { if (fail) throw new Error('consumer startup failed'); },
    });
    const ui = interaction({ MEMORY_LLM_MODEL: 'model:0', KNOWLEDGE_LLM_MODEL: 'model:1' });
    const applying = applyServer(ui, directory, options(engine));
    if (fail) await assert.rejects(applying, /consumer startup failed/); else await applying;
    const baseline = JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'));
    if (fail) assert.deepEqual(baseline, previous);
    else {
      const applied = decodeEnv(baseline['.env']);
      assert.equal(applied.INTERNAL_LLM_SOURCE, 'cliproxy');
      assert.equal(applied.CLIPROXY_AUTH_PROVIDER, 'claude');
      assert.equal(applied.MEMORY_LLM_MODEL, 'model-a'); assert.equal(applied.KNOWLEDGE_LLM_MODEL, 'model-b');
    }
    const desired = await readEnv(join(directory, '.env'));
    assert.equal(desired.CLIPROXY_AUTH_PROVIDER, 'claude');
    assert.equal(desired.MEMORY_LLM_MODEL, 'model-a');
    assert.equal(authorized, true);
  }
});
