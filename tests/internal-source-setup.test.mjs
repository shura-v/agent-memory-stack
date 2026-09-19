import { createNativeSourceFixture, installNativeSourceFixture } from './fixtures/native-source.mjs';
import { updateNativeDocument } from '../dist/config/native-documents.js';
import { normalizeNativeServiceConfigs } from '../dist/config/native-services.js';
import { composeNativeConfiguration, readInstallationEnv, prepareNativeConfiguration, saveNativeConfiguration, orchestrationEnv, readNativeConfiguration } from '../dist/config/native-state.js';
async function readEnv(path) { return readInstallationEnv(dirname(path)); }
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { serverQuestions } from '../dist/setup/questions.js';
import { setupServer, applyServer } from '../dist/setup/server.js';
import { encodeEnv, decodeEnv } from '../dist/config/files.js';
import { resolveSettings } from '../dist/config/settings.js';
import { serviceNames } from '../dist/deployment/model.js';
import { Back, Cancelled } from '../dist/setup/interaction.js';
import { navigate } from '../dist/setup/navigation.js';
import { snapshotSettings } from '../dist/runtime/snapshot.js';
import { captureInputs } from '../dist/setup/server-settings.js';

const external = { LLM_BASE_URL: 'https://models.invalid/v1', LLM_API_KEY: 'external-key',
  CORE_API_KEY: 'core-key', CLIPROXY_API_KEY: 'proxy-key', MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model' };
const local = (overrides = {}) => resolveSettings({ ...external, INTERNAL_LLM_SOURCE: 'cliproxy', ...overrides });
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
  await installNativeSourceFixture(directory);
  const candidate = await prepareNativeConfiguration(directory, env, { root: join(directory, 'native') });
  await saveNativeConfiguration(directory, candidate);
  await writeFile(join(directory, '.env'), encodeEnv(orchestrationEnv(env)));
  await writeFile(join(directory, '.ams/tdai-source.json'), JSON.stringify(candidate.source));
  await writeFile(join(directory, '.ams/images.json'), JSON.stringify(manifest));
  await writeFile(join(directory, '.ams/runtime.json'), JSON.stringify({ provider: 'docker' }));
  return directory;
}
function runtime(events, overrides = {}) {
  return {
    preflight: async () => { events.push('preflight'); },
    hasProviderAuthorization: async () => { events.push('authorized'); return true; },
    apply: async () => { events.push('apply'); },
    login: async () => { events.push('login'); },
    ...overrides,
  };
}
function options(value) {
  return { runtime: () => value, prepareImages: async () => structuredClone(manifest), listModels: noModels };
}

test('fresh Configure asks for both local model IDs without engine or external discovery', async () => {
  const ui = interaction();
  const env = await serverQuestions(ui, {}, { listModels: () => assert.fail('local models are entered directly') });
  const source = ui.questions.find(q => q.id === 'INTERNAL_LLM_SOURCE');
  assert.deepEqual(ui.asked.slice(0, 2), ['CLIPROXY_AUTH_PROVIDER', 'INTERNAL_LLM_SOURCE']);
  assert.equal(source.initial, 'cliproxy');
  assert.deepEqual(source.choices.map(choice => choice.value), ['cliproxy', 'external']);
  assert.equal(env.INTERNAL_LLM_SOURCE, 'cliproxy');
  for (const field of ['LLM_BASE_URL', 'LLM_API_KEY']) assert.ok(!ui.asked.includes(field));
  for (const field of ['MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL']) {
    assert.ok(ui.asked.includes(field));
    assert.equal(env[field], external[field]);
    assert.equal(ui.questions.find(q => q.id === field).validate, undefined);
  }
});

test('explicit external settings stay external and choosing local models preserves external credentials', async () => {
  const externalUI = interaction();
  const configured = await serverQuestions(externalUI, external, { listModels: noModels });
  assert.equal(configured.INTERNAL_LLM_SOURCE, 'external');
  assert.equal(externalUI.questions.find(q => q.id === 'INTERNAL_LLM_SOURCE').initial, 'external');
  assert.ok(externalUI.asked.includes('LLM_BASE_URL'));
  const sharedUI = interaction({ INTERNAL_LLM_SOURCE: 'cliproxy' });
  const shared = await serverQuestions(sharedUI, external, { listModels: () => assert.fail('local mode') });
  for (const field of ['LLM_BASE_URL', 'LLM_API_KEY', 'CORE_API_KEY', 'CLIPROXY_API_KEY', 'MEMORY_LLM_MODEL']) assert.equal(shared[field], external[field]);
});

test('save-only Configure stores empty model IDs without accessing an engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-internal-save-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await installNativeSourceFixture(directory);
  const ui = interaction({ apply: false, MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' });
  await setupServer(ui, { directory, nativeRoot: join(directory, 'native'), listModels: () => assert.fail('no external discovery'),
    prepareImages: () => assert.fail('save-only'), runtime: () => assert.fail('save-only') });
  const saved = await readEnv(join(directory, '.env'));
  assert.equal(saved.INTERNAL_LLM_SOURCE, 'cliproxy');
  assert.equal(saved.MEMORY_LLM_MODEL, '');
  assert.equal(saved.KNOWLEDGE_LLM_MODEL, '');
  assert.doesNotMatch(ui.notes.join('\n'), /select.*after.*authorization/i);
});

test('back navigation changes model source and keeps generated service keys', async () => {
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
    const env = await serverQuestions(questions, {}, { listModels: async () => { discoveries++; return ['external-model']; } });
    if (!first) first = env;
    await questions.confirm('finish-review', 'Finish review?');
    return env;
  });
  assert.equal(first.INTERNAL_LLM_SOURCE, 'external');
  assert.equal(final.INTERNAL_LLM_SOURCE, 'cliproxy');
  assert.equal(final.CORE_API_KEY, first.CORE_API_KEY);
  assert.equal(final.CLIPROXY_API_KEY, first.CLIPROXY_API_KEY);
  assert.equal(final.MEMORY_LLM_MODEL, external.MEMORY_LLM_MODEL);
  assert.equal(final.KNOWLEDGE_LLM_MODEL, external.KNOWLEDGE_LLM_MODEL);
  assert.equal(discoveries, 1);
});

test('immediate setup saves model choices before applying and authorizes the chosen provider afterward', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-internal-immediate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await installNativeSourceFixture(directory);
  const events = [];
  const ui = interaction({ apply: true, CLIPROXY_AUTH_PROVIDER: 'claude', MEMORY_LLM_MODEL: 'manual-memory', KNOWLEDGE_LLM_MODEL: 'manual-knowledge' }, events);
  let authorized = false;
  const engine = runtime(events, {
    hasProviderAuthorization: async provider => { assert.equal(provider, 'claude'); return authorized; },
    login: async provider => { assert.equal(provider, 'claude'); events.push('login'); authorized = true; },
    apply: async (_key, { createAdminKey }) => {
      assert.equal(typeof createAdminKey, 'function');
      const saved = await readEnv(join(directory, '.env'));
      assert.equal(saved.MEMORY_LLM_MODEL, 'manual-memory');
      assert.equal(saved.KNOWLEDGE_LLM_MODEL, 'manual-knowledge');
      events.push('apply');
    },
  });
  await setupServer(ui, { ...options(engine), directory, nativeRoot: join(directory, 'native') });
  assert.ok(events.indexOf('question:KNOWLEDGE_LLM_MODEL') < events.indexOf('preflight'));
  assert.ok(events.indexOf('apply') < events.indexOf('login'));
  assert.equal(ui.asked.filter(id => id === 'CLIPROXY_AUTH_PROVIDER').length, 1);
  const repeated = interaction();
  await applyServer(repeated, directory, options(engine));
  assert.equal(events.filter(event => event === 'login').length, 1);
  assert.deepEqual(repeated.asked, []);
});

test('Apply preserves empty model IDs without model questions or discoveries', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  const events = [], ui = interaction();
  const before = await readNativeConfiguration(directory);
  await applyServer(ui, directory, { ...options(runtime(events)), listModels: () => assert.fail('Apply does not discover models') });
  assert.deepEqual(ui.asked, []);
  assert.ok(events.includes('apply'));
  const after = await readNativeConfiguration(directory);
  assert.deepEqual(after.overrides, before.overrides);
  const captured = JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'));
  const baseline = normalizeNativeServiceConfigs(decodeEnv(captured['.env']), composeNativeConfiguration(JSON.parse(captured['.ams/native-backup.json'])));
  assert.equal(baseline.MEMORY_LLM_MODEL, '');
  assert.equal(baseline.KNOWLEDGE_LLM_MODEL, '');
});

test('cancelling Configure at the second model leaves both saved choices and applied baseline intact', async t => {
  const directory = await fixture(t);
  const before = await captureInputs(directory);
  await writeFile(join(directory, '.ams/last-applied-inputs.json'), JSON.stringify(before));
  const ui = interaction({ MEMORY_LLM_MODEL: 'new-memory', KNOWLEDGE_LLM_MODEL: () => { throw new Cancelled(); } });
  await assert.rejects(setupServer(ui, { directory, ...options(runtime([], { apply: () => assert.fail('Configure cancelled') })) }), Cancelled);
  assert.deepEqual(await captureInputs(directory), before);
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8')), before);
  const resumed = interaction({ MEMORY_LLM_MODEL: 'new-memory', KNOWLEDGE_LLM_MODEL: 'new-knowledge', apply: false });
  await setupServer(resumed, { directory, ...options(runtime([])) });
  const saved = await readEnv(join(directory, '.env'));
  assert.equal(saved.MEMORY_LLM_MODEL, 'new-memory');
  assert.equal(saved.KNOWLEDGE_LLM_MODEL, 'new-knowledge');
});

test('saved unlisted model IDs pass through Apply unchanged', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: 'unlisted/model', KNOWLEDGE_LLM_MODEL: 'another-unlisted-model' }));
  const ui = interaction();
  await applyServer(ui, directory, { ...options(runtime([])), listModels: () => assert.fail('Apply must not inspect the account model list') });
  assert.deepEqual(ui.asked, []);
  assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, 'unlisted/model');
});

test('Configure accepts literal custom and empty model input without validation callbacks', async () => {
  const ui = interaction({ MEMORY_LLM_MODEL: ' <operator-model> ', KNOWLEDGE_LLM_MODEL: '' });
  const saved = await serverQuestions(ui, local(), { listModels: () => assert.fail('local model names are manual') });
  assert.equal(saved.MEMORY_LLM_MODEL, ' <operator-model> ');
  assert.equal(saved.KNOWLEDGE_LLM_MODEL, '');
  for (const question of ui.questions.filter(q => q.id.endsWith('LLM_MODEL'))) assert.equal(question.validate, undefined);
});

test('noninteractive Apply accepts saved empty local models without prompting', async t => {
  const directory = await fixture(t, local({ MEMORY_LLM_MODEL: '', KNOWLEDGE_LLM_MODEL: '' }));
  const ui = interaction(); ui.interactive = false;
  const events = [];
  await applyServer(ui, directory, options(runtime(events)));
  assert.ok(events.includes('apply'));
  assert.deepEqual(ui.asked, []);
});

test('configured model choices become the applied baseline only after successful consumer startup', async t => {
  for (const fail of [false, true]) {
    const directory = await fixture(t);
    const previous = await captureInputs(directory);
    await writeFile(join(directory, '.ams/last-applied-inputs.json'), JSON.stringify(previous));
    await setupServer(interaction({ CLIPROXY_AUTH_PROVIDER: 'claude', MEMORY_LLM_MODEL: 'new-memory', KNOWLEDGE_LLM_MODEL: 'new-knowledge', apply: false }), {
      directory, ...options(runtime([])),
    });
    const engine = runtime([], {
      snapshot: async () => snapshotSettings(directory),
      apply: async () => { if (fail) throw new Error('consumer startup failed'); },
    });
    const ui = interaction();
    const applying = applyServer(ui, directory, options(engine));
    if (fail) await assert.rejects(applying, /consumer startup failed/); else await applying;
    const baseline = JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'));
    if (fail) assert.deepEqual(baseline, previous);
    else {
      const applied = normalizeNativeServiceConfigs(decodeEnv(baseline['.env']), composeNativeConfiguration(JSON.parse(baseline['.ams/native-backup.json'])));
      assert.equal(applied.CLIPROXY_AUTH_PROVIDER, 'claude');
      assert.equal(applied.MEMORY_LLM_MODEL, 'new-memory');
      assert.equal(applied.KNOWLEDGE_LLM_MODEL, 'new-knowledge');
    }
    assert.deepEqual(ui.asked, []);
    assert.equal(await readFile(join(directory, '.ams/previous-settings/.env'), 'utf8'), previous['.env']);
    assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, 'new-memory');
  }
});

test('Configure during a pending update edits active defaults and Apply activates the target without model questions', async t => {
  const directory = await fixture(t);
  const before = await readNativeConfiguration(directory);
  const activeImages = await readFile(join(directory, '.ams/images.json'), 'utf8');
  const activeSource = await readFile(join(directory, '.ams/tdai-source.json'), 'utf8');
  const revision = 'b'.repeat(40);
  const templates = createNativeSourceFixture({ revision, files: { 'core.yaml': before.defaults['core.yaml'] + '\n# Upgraded template marker\n' } });
  const source = templates.source;
  await installNativeSourceFixture(directory, templates, { select: false });
  await writeFile(join(directory, '.ams/pending-tdai-source.json'), JSON.stringify(source));
  const upgradedImages = structuredClone(manifest);
  upgradedImages.images.core.id = 'sha256:' + 'b'.repeat(64);
  await setupServer(interaction({ MEMORY_LLM_MODEL: 'configured-memory', KNOWLEDGE_LLM_MODEL: '', apply: false }), {
    directory, ...options(runtime([])),
  });
  const saved = await readNativeConfiguration(directory);
  assert.deepEqual(saved.defaults, before.defaults);
  assert.equal(await readFile(join(directory, '.ams/tdai-source.json'), 'utf8'), activeSource);
  assert.equal(await readFile(join(directory, '.ams/images.json'), 'utf8'), activeImages);
  assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, 'configured-memory');
  const ui = interaction();
  await applyServer(ui, directory, { prepareImages: async options => { assert.equal(options.source.revision, revision); return upgradedImages; }, runtime: () => runtime([]) });
  assert.deepEqual(ui.asked, []);
  const activated = await readNativeConfiguration(directory);
  assert.deepEqual(activated.defaults, templates.files);
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.ams/tdai-source.json'), 'utf8')), source);
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.ams/images.json'), 'utf8')), upgradedImages);
  const applied = JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'));
  assert.deepEqual(JSON.parse(applied['.ams/native-backup.json']).defaults, templates.files);
  assert.equal((await readEnv(join(directory, '.env'))).KNOWLEDGE_LLM_MODEL, '');
  await assert.rejects(readFile(join(directory, '.ams/pending-tdai-source.json')), { code: 'ENOENT' });
});

test('native model edits during image preparation stop activation without overwriting the operator', async t => {
  const directory = await fixture(t);
  const path = join(directory, 'native/overrides/core.yaml');
  const changed = updateNativeDocument(await readFile(path, 'utf8'), 'yaml', [{ path: ['llm', 'model'], value: 'concurrent-model' }]);
  const ui = interaction();
  await assert.rejects(applyServer(ui, directory, {
    ...options(runtime([], { apply: () => assert.fail('concurrent edit must stop activation') })),
    prepareImages: async () => { await writeFile(path, changed); return manifest; },
  }), /Native configuration changed after preparation/);
  assert.equal(await readFile(path, 'utf8'), changed);
  assert.deepEqual(ui.asked, []);
});

test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access in native unit test'); }));


test('fresh save-only Configure downloads selected templates without running an engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-configure-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await installNativeSourceFixture(directory);
  await rm(join(directory, '.ams-build'), { recursive: true });
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => { requested.push(String(url)); return new Response(fixture.bytes); });
  const ui = interaction({ apply: false });
  await setupServer(ui, {
    directory, nativeRoot: join(directory, 'native'), listModels: () => assert.fail('local source does not query model APIs'),
    runtime: () => assert.fail('Configure does not access an engine'), prepareImages: () => assert.fail('Configure does not build images'),
  });
  assert.deepEqual(requested, [fixture.source.url]);
  const saved = await readNativeConfiguration(directory);
  assert.deepEqual(saved.defaults, fixture.files);
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.ams/tdai-source.json'), 'utf8')), fixture.source);
  assert.equal((await readEnv(join(directory, '.env'))).MEMORY_LLM_MODEL, external.MEMORY_LLM_MODEL);
});
