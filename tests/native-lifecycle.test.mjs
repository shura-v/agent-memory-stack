import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeSourceFixture, installNativeSourceFixture, nativeSourceFiles } from './fixtures/native-source.mjs';
import { parseNativeDocument, updateNativeDocument } from '../dist/config/native-documents.js';
import { proxyAdminKey } from '../dist/config/native-services.js';
import { captureNativeConfiguration, nativeConfigurationRoot, orchestrationEnv, prepareNativeConfiguration, readInstallationEnv, readNativeDocuments, readNativeConfiguration, saveNativeConfiguration, stageNativeRuntime } from '../dist/config/native-state.js';
import { encodeEnv } from '../dist/config/files.js';
import { resolveSettings } from '../dist/config/settings.js';
import { applyServer } from '../dist/setup/server.js';
import { snapshotSettings } from '../dist/runtime/snapshot.js';
import { restoreNativeSnapshot } from '../dist/runtime/restore-native.js';
import { generate } from '../dist/runtime/config.js';

async function fixture(t, { initialize = true, settings = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-native-lifecycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, 'runtime');
  const root = join(directory, 'config');
  await mkdir(project);
  const env = {
    LLM_BASE_URL: 'https://provider.synthetic.invalid/v1', LLM_API_KEY: 'synthetic-provider-key',
    MEMORY_LLM_MODEL: 'memory-test', KNOWLEDGE_LLM_MODEL: 'knowledge-test',
    CORE_API_KEY: 'synthetic-core-key', CLIPROXY_API_KEY: 'synthetic-model-key',
    ...settings,
  };
  const revisions = new Map();
  async function revision(digit, edits = {}) {
    const files = { ...nativeSourceFiles };
    for (const [name, changes] of Object.entries(edits)) files[name] = updateNativeDocument(files[name], name.endsWith('.yaml') ? 'yaml' : 'env', changes);
    const fixture = createNativeSourceFixture({ revision: digit.repeat(40), files });
    await installNativeSourceFixture(project, fixture, { select: false });
    revisions.set(fixture.source.revision, fixture);
    return fixture.source;
  }
  const source = await revision('a', { 'core.yaml': [{ path: ['futureOption'], value: 'upstream-default' }], 'proxy.yaml': [{ path: ['futureOption'], value: 'upstream-default' }] });
  const prepare = (options = {}, input = env) => prepareNativeConfiguration(project, input, { root, source, ...options });
  if (initialize) await saveNativeConfiguration(project, await prepare());
  const edit = async (name, edits) => {
    const path = join(root, 'overrides', name);
    await writeFile(path, updateNativeDocument(await readFile(path, 'utf8'), name.endsWith('.yaml') ? 'yaml' : 'env', edits));
  };
  return { project, root, env, source, prepare, edit, revision, revisions };
}
const value = text => parseNativeDocument(text, 'yaml');

test('same-revision apply preserves native manual fields and dedicated key without rewriting user files', async t => {
  const f = await fixture(t);
  const initialKey = proxyAdminKey(await readNativeDocuments(f.project));
  assert.match(initialKey, /^sk-ams-proxy-admin-[a-f0-9]{64}$/);
  await f.edit('core.yaml', [{ path: ['llm', 'model'], value: 'manual-model' }, { path: ['userAdded'], value: { enabled: true } }]);
  const path = join(f.root, 'overrides/core.yaml');
  const before = await readFile(path, 'utf8');
  const modified = (await stat(path)).mtimeMs;
  const candidate = await f.prepare();
  assert.equal(value(candidate.documents['core.yaml']).llm.model, 'manual-model');
  assert.equal(proxyAdminKey(candidate.documents), initialKey);
  await saveNativeConfiguration(f.project, candidate);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.equal((await stat(path)).mtimeMs, modified);
  assert.equal((await stat(join(f.project, '.ams/native-config.json'))).mode & 0o777, 0o600);
  await assert.rejects(stat(join(f.root, '.ams-state.json')), { code: 'ENOENT' });
  assert.equal((await stat(f.root)).mode & 0o777, 0o700);
});

test('removing or emptying initialized admin.apiKey stays operator-owned without reseeding', async t => {
  for (const edit of [{ path: ['admin', 'apiKey'], delete: true }, { path: ['admin', 'apiKey'], value: '' }]) {
    await t.test(edit.delete ? 'missing' : 'empty', async t => {
      const f = await fixture(t);
      await f.edit('proxy.yaml', [edit]);
      const before = await captureNativeConfiguration(f.project);
      const candidate = await f.prepare();
      assert.equal(proxyAdminKey(candidate.documents), '');
      await saveNativeConfiguration(f.project, candidate);
      assert.equal(await captureNativeConfiguration(f.project), before);
    });
  }
});

test('saved root association survives XDG changes and complete sets can be adopted by another installation', async t => {
  const f = await fixture(t);
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(f.root, 'different-xdg');
  t.after(() => { if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousXdg; });
  assert.equal(await nativeConfigurationRoot(f.project), f.root);
  const other = join(f.project, 'another-installation');
  await mkdir(other);
  const adopted = await prepareNativeConfiguration(other, f.env, { root: f.root });
  assert.deepEqual(adopted.defaults, (await readNativeConfiguration(f.project)).defaults);
  await saveNativeConfiguration(other, adopted);
  assert.deepEqual(JSON.parse(await readFile(join(other, '.ams/native-config.json'), 'utf8')), {
    version: 1, root: f.root, originsFinalized: true,
  });
});

test('host edits between preparation and activation are rejected without replacing them', async t => {
  const f = await fixture(t);
  const candidate = await f.prepare();
  await f.edit('core.yaml', [{ path: ['changedDuringBuild'], value: true }]);
  const before = await captureNativeConfiguration(f.project);
  await assert.rejects(saveNativeConfiguration(f.project, candidate), /changed after preparation/);
  assert.equal(await captureNativeConfiguration(f.project), before);
  const fresh = await f.prepare();
  await saveNativeConfiguration(f.project, fresh);
  await saveNativeConfiguration(f.project, fresh);
  assert.equal(value((await readNativeDocuments(f.project))['core.yaml']).changedDuringBuild, true);
});

test('native root defaults, absolute XDG and explicit roots resolve without creating directories', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ams-native-roots-'));
  const oldXdg = process.env.XDG_CONFIG_HOME;
  t.after(async () => {
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
    await rm(directory, { recursive: true, force: true });
  });
  delete process.env.XDG_CONFIG_HOME;
  assert.equal(await nativeConfigurationRoot(directory), join(homedir(), '.config/agent-memory-stack'));
  process.env.XDG_CONFIG_HOME = join(directory, 'xdg');
  assert.equal(await nativeConfigurationRoot(directory), join(directory, 'xdg/agent-memory-stack'));
  process.env.XDG_CONFIG_HOME = 'relative-root';
  await assert.rejects(nativeConfigurationRoot(directory), /XDG_CONFIG_HOME must be an absolute path/);
  const explicit = join(directory, 'explicit');
  assert.equal(await nativeConfigurationRoot(directory, explicit), explicit);
  await assert.rejects(nativeConfigurationRoot(directory, 'relative'), /Native configuration root must be an absolute path/);
  await assert.rejects(stat(explicit), { code: 'ENOENT' });
});

test('upgrade preparation failures retain active source, image manifest and native configuration', async t => {
  for (const failure of ['build', 'preflight', 'env-edit', 'target-edit', 'startup']) {
    await t.test(failure, async t => {
      const f = await fixture(t);
      const source = await f.revision('b', { 'core.yaml': [{ path: ['futureOption'], value: 'upstream-default' }], 'proxy.yaml': [{ path: ['futureOption'], value: 'upstream-default' }] });
      const images = revision => ({ schemaVersion: 1, images: Object.fromEntries(['core', 'knowledge', 'panel', 'memory-proxy', 'mcp', 'cli-proxy-api', 'runtime'].map(service => [service, { id: `sha256:${revision.repeat(64)}`, tag: service, platform: 'linux/arm64', repoDigests: [] }])) });
      const oldImages = images('a');
      const newImages = images('b');
      await writeFile(join(f.project, '.env'), encodeEnv(orchestrationEnv(resolveSettings(f.env))));
      await writeFile(join(f.project, '.ams/tdai-source.json'), JSON.stringify(f.source));
      await writeFile(join(f.project, '.ams/images.json'), JSON.stringify(oldImages));
      await writeFile(join(f.project, '.ams/pending-tdai-source.json'), JSON.stringify(source));
      const beforeNative = await captureNativeConfiguration(f.project);
      const assertActive = async () => {
        assert.equal(await captureNativeConfiguration(f.project), beforeNative);
        assert.deepEqual(JSON.parse(await readFile(join(f.project, '.ams/tdai-source.json'), 'utf8')), f.source);
        assert.deepEqual(JSON.parse(await readFile(join(f.project, '.ams/images.json'), 'utf8')), oldImages);
      };
      const calls = [];
      const ui = { interactive: false, note() {}, async handoff() { assert.fail('No administrator initialization needed'); }, async confirm() { assert.fail('No staged integrations'); } };
      const options = {
        nativeRoot: f.root,
        prepareImages: async () => {
          calls.push('build'); await assertActive();
          if (failure === 'build') throw new Error('synthetic image build failed');
          if (failure === 'env-edit') await writeFile(join(f.project, '.env'), (await readFile(join(f.project, '.env'), 'utf8')) + '# operator changed configuration during build\n');
          if (failure === 'target-edit') await writeFile(join(f.project, '.ams/pending-tdai-source.json'), JSON.stringify({ ...source, sha256: 'c'.repeat(64) }));
          return newImages;
        },
        runtime: () => ({
          checkProvider: async () => { calls.push('provider'); },
          preflight: async () => { calls.push('preflight'); await assertActive(); if (failure === 'preflight') throw new Error('synthetic preflight failed'); return { pending: [] }; },
          snapshot: async () => { calls.push('snapshot'); await assertActive(); await snapshotSettings(f.project); },
          apply: async () => { calls.push('startup'); throw new Error('synthetic startup failed'); },
          hasProviderAuthorization: async () => true,
        }),
      };
      await assert.rejects(applyServer(ui, f.project, options), failure.endsWith('-edit') ? /Saved configuration or target revision changed during preparation/
          : new RegExp(`synthetic (?:image )?${failure} failed`));
      if (failure !== 'startup') {
        await assertActive();
        assert.ok(!calls.includes('snapshot') && !calls.includes('startup'));
      } else {
        assert.deepEqual(calls, ['provider', 'build', 'preflight', 'snapshot', 'startup']);
        const previous = join(f.project, '.ams/previous-settings/.ams');
        assert.deepEqual(JSON.parse(await readFile(join(previous, 'tdai-source.json'), 'utf8')), f.source);
        assert.deepEqual(JSON.parse(await readFile(join(previous, 'images.json'), 'utf8')), oldImages);
        assert.deepEqual(JSON.parse(await readFile(join(previous, 'native-backup.json'), 'utf8')), JSON.parse(beforeNative));
        assert.deepEqual(JSON.parse(await readFile(join(f.project, '.ams/tdai-source.json'), 'utf8')), source);
        const afterFailure = await captureNativeConfiguration(f.project);
        await assert.rejects(restoreNativeSnapshot(f.project, join(previous, '..')), /Restore matching source and image records/);
        assert.equal(await captureNativeConfiguration(f.project), afterFailure);
        for (const name of ['tdai-source.json', 'images.json']) await writeFile(join(f.project, '.ams', name), await readFile(join(previous, name)));
        await restoreNativeSnapshot(f.project, join(previous, '..'));
        assert.equal(await captureNativeConfiguration(f.project), beforeNative);
      }
    });
  }
});

test('switching from CLIProxyAPI to external uses native connections for both internal consumers', async t => {
  const f = await fixture(t, { settings: {
    INTERNAL_LLM_SOURCE: 'cliproxy', LLM_BASE_URL: '', LLM_API_KEY: '',
  } });
  const settings = orchestrationEnv(resolveSettings(f.env));
  settings.INTERNAL_LLM_SOURCE = 'external';
  await writeFile(join(f.project, '.env'), encodeEnv(settings));
  await f.edit('core.yaml', [
    { path: ['llm', 'baseUrl'], value: 'https://core-model.synthetic.invalid/v1' },
    { path: ['llm', 'apiKey'], value: 'native-core-model-key' },
  ]);
  await f.edit('knowledge.env', [
    { path: ['LLM_BASE_URL'], value: 'https://knowledge-model.synthetic.invalid/v1' },
    { path: ['LLM_API_KEY'], value: 'native-knowledge-model-key' },
  ]);
  const before = await readNativeDocuments(f.project);
  for (let iteration = 0; iteration < 2; iteration++) {
    const effective = resolveSettings(await readInstallationEnv(f.project));
    const candidate = await f.prepare({}, effective);
    assert.deepEqual(candidate.documents, before);
    await saveNativeConfiguration(f.project, candidate);
    await stageNativeRuntime(f.project, candidate, effective);
    const generated = await generate(f.project);
    const core = parseNativeDocument(await readFile(join(generated.generated, 'core.yaml'), 'utf8'), 'yaml');
    assert.equal(core.llm.baseUrl, 'https://core-model.synthetic.invalid/v1');
    assert.equal(core.llm.apiKey, 'native-core-model-key');
    const knowledge = parseNativeDocument(await readFile(join(generated.generated, 'knowledge.env'), 'utf8'), 'env');
    assert.equal(knowledge.LLM_BASE_URL, 'https://knowledge-model.synthetic.invalid/v1');
    assert.equal(knowledge.LLM_API_KEY, 'native-knowledge-model-key');
  }
});

test('complete native sets survive a missing root reference without reseeding', async t => {
  const f = await fixture(t);
  await f.edit('core.yaml', [{ path: ['llm', 'model'], value: 'operator-model' }]);
  const candidate = await f.prepare();
  const documents = await readNativeDocuments(f.project);
  const overrides = await Promise.all(Object.keys(candidate.overrides).map(name => readFile(join(f.root, 'overrides', name), 'utf8')));
  await rm(join(f.project, '.ams/native-config.json'));
  const oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = f.root;
  t.after(() => { if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg; });
  // An explicit root works before its reference is recreated, independently of XDG.
  assert.deepEqual(await readNativeDocuments(f.project, f.root), documents);
  assert.equal((await readInstallationEnv(f.project, f.root)).MEMORY_LLM_MODEL, 'operator-model');
  const backup = JSON.parse(await captureNativeConfiguration(f.project, f.root));
  assert.equal(backup.root, f.root);
  assert.equal(Object.hasOwn(backup, 'state'), false);
  assert.equal(Object.hasOwn(backup, 'originsFinalized'), false);
  await assert.rejects(readFile(join(f.root, '.ams-state.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.project, '.ams/native-config.json')), { code: 'ENOENT' });
  assert.deepEqual((await f.prepare()).documents, documents);
  await saveNativeConfiguration(f.project, candidate);
  assert.equal(JSON.parse(await readFile(join(f.project, '.ams/native-config.json'), 'utf8')).root, f.root);
  assert.deepEqual(await readNativeDocuments(f.project), documents);
  assert.deepEqual(await Promise.all(Object.keys(candidate.overrides).map(name => readFile(join(f.root, 'overrides', name), 'utf8'))), overrides);
});

test('initial native save accepts missing or empty roots and remains idempotent', async t => {
  for (const exists of [false, true]) await t.test(exists ? 'empty root' : 'missing root', async t => {
    const f = await fixture(t, { initialize: false });
    if (exists) await mkdir(f.root);
    const candidate = await f.prepare();
    await saveNativeConfiguration(f.project, candidate);
    await saveNativeConfiguration(f.project, candidate);
    assert.deepEqual(await readNativeDocuments(f.project), candidate.documents);
  });
});

test('missing root reference does not regenerate a deliberately removed override', async t => {
  const f = await fixture(t);
  const path = join(f.root, 'overrides/proxy.yaml');
  await rm(path);
  await rm(join(f.project, '.ams/native-config.json'));
  const candidate = await f.prepare();
  assert.equal(candidate.overrides['proxy.yaml'], undefined);
  assert.equal(proxyAdminKey(candidate.documents), '');
  await saveNativeConfiguration(f.project, candidate);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('missing root reference does not regenerate an intentionally removed administrative key', async t => {
  const f = await fixture(t);
  await f.edit('proxy.yaml', [{ path: ['admin', 'apiKey'], delete: true }]);
  const before = await readFile(join(f.root, 'overrides/proxy.yaml'), 'utf8');
  await rm(join(f.project, '.ams/native-config.json'));
  const candidate = await f.prepare();
  assert.equal(proxyAdminKey(candidate.documents), '');
  await saveNativeConfiguration(f.project, candidate);
  assert.equal(await readFile(join(f.root, 'overrides/proxy.yaml'), 'utf8'), before);
  assert.equal(proxyAdminKey(await readNativeDocuments(f.project)), '');
});

test('incomplete native sets fail without a reference and remain untouched', async t => {
  for (const name of ['defaults', 'overrides']) await t.test(name, async t => {
    const f = await fixture(t, { initialize: false });
    await mkdir(f.root);
    const path = join(f.root, name, 'operator-file');
    await mkdir(join(f.root, name));
    const contents = 'Unassociated native content must be preserved.\n';
    await writeFile(path, contents);
    await assert.rejects(f.prepare(), /Missing native configuration/);
    assert.equal(await readFile(path, 'utf8'), contents);
    await assert.rejects(readFile(join(f.project, '.ams/native-config.json')), { code: 'ENOENT' });
  });
});

test('.ams-state.json is unrelated and never read, rewritten or removed', async t => {
  const f = await fixture(t, { initialize: false });
  await mkdir(f.root);
  const path = join(f.root, '.ams-state.json');
  const contents = 'retained operator file\n';
  await writeFile(path, contents);
  await saveNativeConfiguration(f.project, await f.prepare());
  assert.equal(await readFile(path, 'utf8'), contents);
});

test('all five defaults stay byte-exact while partial overlays contain only installation settings', async t => {
  const f = await fixture(t);
  const saved = await readNativeConfiguration(f.project);
  assert.equal(Object.keys(saved.defaults).length, 5);
  assert.equal(Object.keys(saved.overrides).length, 5);
  assert.deepEqual(saved.defaults, f.revisions.get(f.source.revision).files);
  assert.equal(value(saved.overrides['core.yaml']).futureOption, undefined);
  assert.equal(value((await readNativeDocuments(f.project))['core.yaml']).futureOption, 'upstream-default');
  const reference = JSON.parse(await readFile(join(f.project, '.ams/native-config.json'), 'utf8'));
  assert.deepEqual(reference, { version: 1, root: f.root, originsFinalized: true });
  const backup = JSON.parse(await captureNativeConfiguration(f.project));
  assert.equal(Object.hasOwn(backup, 'state'), false);
  assert.equal(Object.hasOwn(backup, 'originsFinalized'), false);
});

test('successive template upgrades retain exact overrides and deletion declarations for all services', async t => {
  const f = await fixture(t);
  await f.edit('core.yaml', [{ path: ['futureOption'], value: 'operator-value' }]);
  await f.edit('proxy.yaml', [{ path: ['futureOption'], value: 'proxy-operator' }]);
  const overrides = (await readNativeConfiguration(f.project)).overrides;
  const deleted = '{"core.yaml":["/newOption"]}\n';
  await writeFile(join(f.root, 'overrides/deletions.json'), deleted);
  for (const digit of ['b', 'c']) {
    const source = await f.revision(digit, { 'core.yaml': [{ path: ['futureOption'], value: `new-${digit}` }, { path: ['newOption'], value: true }], 'proxy.yaml': [{ path: ['futureOption'], value: digit }] });
    const candidate = await f.prepare({ source }, f.env);
    assert.equal(value(candidate.documents['core.yaml']).futureOption, 'operator-value');
    assert.equal(value(candidate.documents['core.yaml']).newOption, undefined);
    assert.equal(value(candidate.documents['proxy.yaml']).futureOption, 'proxy-operator');
    assert.deepEqual(candidate.overrides, overrides);
    assert.equal(candidate.deletions, deleted);
    assert.equal(candidate.source.revision, source.revision);
    assert.equal(value(candidate.defaults['proxy.yaml']).futureOption, digit);
    await saveNativeConfiguration(f.project, candidate);
    await f.prepare({ source });
  }
  await f.edit('core.yaml', [{ path: ['futureOption'], delete: true }]);
  const restoredInheritance = await f.prepare({ source: f.revisions.get('c'.repeat(40)).source });
  assert.equal(value(restoredInheritance.documents['core.yaml']).futureOption, 'new-c');
});

test('ordinary preparation accepts operator default edits and explicit source replacement restores selected defaults', async t => {
  const f = await fixture(t);
  await rm(join(f.project, '.ams-build'), { recursive: true });
  assert.deepEqual((await prepareNativeConfiguration(f.project, f.env, { root: f.root })).documents, await readNativeDocuments(f.project));
  await writeFile(join(f.root, 'defaults/core.yaml'), 'changed: true\n');
  const ordinary = await prepareNativeConfiguration(f.project, f.env, { root: f.root });
  assert.equal(ordinary.defaults['core.yaml'], 'changed: true\n');
  assert.equal(value(ordinary.documents['core.yaml']).changed, true);
  await installNativeSourceFixture(f.project, f.revisions.get(f.source.revision), { select: false });
  const replacement = await f.prepare({ source: f.source });
  assert.deepEqual(replacement.defaults, f.revisions.get(f.source.revision).files);
});

test('explicit wizard edits change reviewed fields only; ordinary apply preserves overrides', async t => {
  const f = await fixture(t);
  await f.edit('core.yaml', [{ path: ['unrelated'], value: 'preserved' }]);
  let candidate = await f.prepare({}, { ...f.env, MEMORY_LLM_MODEL: 'unreviewed-env-model' });
  assert.equal(value(candidate.documents['core.yaml']).llm.model, 'memory-test');
  candidate = await f.prepare({ edits: { MEMORY_LLM_MODEL: 'reviewed-model' } });
  assert.equal(value(candidate.documents['core.yaml']).llm.model, 'reviewed-model');
  assert.equal(value(candidate.documents['core.yaml']).unrelated, 'preserved');
  await saveNativeConfiguration(f.project, candidate);
  await f.edit('core.yaml', [{ path: ['server', 'apiKey'], value: 'rotated-key' }]);
  const independent = await f.prepare();
  assert.equal(value(independent.documents['core.yaml']).server.apiKey, 'rotated-key');
  assert.equal(value(independent.documents['proxy.yaml']).tdai.apiKey, f.env.CORE_API_KEY);
  const rotated = await f.prepare({ edits: { CORE_API_KEY: 'rotated-key' } }, { ...f.env, CORE_API_KEY: 'rotated-key' });
  assert.equal(value(rotated.documents['proxy.yaml']).tdai.apiKey, 'rotated-key');
});

test('first port allocation fills deferred origins once and preserves later custom origins', async t => {
  const f = await fixture(t, { initialize: false });
  const initial = await f.prepare({ deferOrigins: ['MEMORY_PROXY_PUBLIC_URL'] });
  assert.equal(initial.originsFinalized, false);
  assert.equal(value(initial.overrides['proxy.yaml']).injection.externalGatewayUrl, '');
  await saveNativeConfiguration(f.project, initial);
  const allocated = await f.prepare({ finalizeOrigins: true }, { ...f.env, MEMORY_PROXY_PUBLIC_URL: 'http://127.0.0.1:19096' });
  assert.equal(value(allocated.documents['proxy.yaml']).injection.externalGatewayUrl, 'http://127.0.0.1:19096');
  await saveNativeConfiguration(f.project, allocated);
  await f.edit('proxy.yaml', [{ path: ['injection', 'externalGatewayUrl'], value: 'https://custom.synthetic.invalid' }]);
  const later = await f.prepare({ finalizeOrigins: true }, { ...f.env, MEMORY_PROXY_PUBLIC_URL: 'http://127.0.0.1:29096' });
  assert.equal(value(later.documents['proxy.yaml']).injection.externalGatewayUrl, 'https://custom.synthetic.invalid');
});

test('source choices preserve native model connections until explicitly edited', async t => {
  const f = await fixture(t);
  const unchanged = await f.prepare({}, { ...f.env, INTERNAL_LLM_SOURCE: 'cliproxy' });
  assert.equal(value(unchanged.documents['core.yaml']).llm.baseUrl, f.env.LLM_BASE_URL);
  const local = await f.prepare({ edits: { INTERNAL_LLM_SOURCE: 'cliproxy' } }, { ...f.env, INTERNAL_LLM_SOURCE: 'cliproxy' });
  assert.equal(value(local.documents['core.yaml']).llm.baseUrl, 'http://cli-proxy-api:8317/v1');
  await saveNativeConfiguration(f.project, local);
  assert.equal(value((await f.prepare()).documents['core.yaml']).llm.baseUrl, 'http://cli-proxy-api:8317/v1');
});

test('saved full-stack candidates remain current after repeated saves', async t => {
  const f = await fixture(t, { initialize: false });
  const candidate = await f.prepare();
  await saveNativeConfiguration(f.project, candidate);
  await saveNativeConfiguration(f.project, candidate);
  assert.deepEqual(await readNativeDocuments(f.project), candidate.documents);
});

test('removing an override allows the new upstream admin default to compose without reseeding', async t => {
  const f = await fixture(t);
  const source = await f.revision('b', { 'proxy.yaml': [{ path: ['admin', 'apiKey'], value: 'upstream-template-key' }] });
  await saveNativeConfiguration(f.project, await f.prepare({ source }));
  await f.edit('proxy.yaml', [{ path: ['admin', 'apiKey'], delete: true }]);
  const candidate = await f.prepare({ source });
  assert.equal(proxyAdminKey(candidate.documents), 'upstream-template-key');
  assert.equal(proxyAdminKey(candidate.overrides), '');
});

test('orchestration retains Panel origin and removes native-owned origins', () => {
  const input = { MEMORY_PROXY_PUBLIC_URL: 'https://proxy.synthetic.invalid', KNOWLEDGE_PUBLIC_URL: 'https://knowledge.synthetic.invalid', PANEL_PUBLIC_URL: 'https://panel.synthetic.invalid' };
  const env = orchestrationEnv(input);
  assert.equal(env.MEMORY_PROXY_PUBLIC_URL, undefined);
  assert.equal(env.KNOWLEDGE_PUBLIC_URL, undefined);
  assert.equal(env.PANEL_PUBLIC_URL, input.PANEL_PUBLIC_URL);

});

test('changing the runtime root association invalidates a prepared candidate', async t => {
  const f = await fixture(t);
  const candidate = await f.prepare();
  const reference = join(f.project, '.ams/native-config.json');
  const changed = JSON.stringify({ version: 1, root: join(f.root, '..', 'different'), originsFinalized: true });
  await writeFile(reference, changed);
  await assert.rejects(saveNativeConfiguration(f.project, candidate), /native-config\.json/);
  assert.equal(await readFile(reference, 'utf8'), changed);
});


test('operator native values survive preparation and reach the frozen runtime unchanged', async t => {
  const f = await fixture(t);
  await f.edit('core.yaml', [
    { path: ['server', 'host'], value: '127.3.2.1' },
    { path: ['server', 'port'], value: 9000 },
    { path: ['server', 'apiKey'], value: '' },
    { path: ['data', 'baseDir'], value: '/operator/data' },
    { path: ['metadata', 'store', 'sqliteBaseDir'], value: '/operator/metadata' },
    { path: ['llm', 'baseUrl'], value: 'custom+scheme://operator/model/' },
    { path: ['llm', 'apiKey'], value: ' key with surrounding spaces ' },
    { path: ['llm', 'model'], value: '' },
    { path: ['llm', 'maxTokens'], value: -1 },
    { path: ['llm', 'timeoutMs'], value: 0 },
    { path: ['memory', 'promptMode'], value: 'operator-mode' },
  ]);
  await f.edit('proxy.yaml', [
    { path: ['admin', 'apiKey'], value: '' },
    { path: ['server', 'port'], value: 9096 },
    { path: ['storage', 'sqlite', 'dbPath'], value: '/operator/proxy.db' },
    { path: ['tdai', 'endpoint'], value: 'operator-core-url' },
    { path: ['tdai', 'apiKey'], value: 'independent-proxy-key' },
    { path: ['injection', 'externalGatewayUrl'], value: '' },
  ]);
  await f.edit('knowledge.env', [
    { path: ['API_PREFIX'], value: '/custom' },
    { path: ['PORT'], value: 'custom-port' },
    { path: ['KNOWLEDGE_DATA_DIR'], value: '/operator/knowledge' },
    { path: ['KNOWLEDGE_PUBLIC_BASE_URL'], value: '' },
    { path: ['LLM_BASE_URL'], value: 'independent-knowledge-model/' },
    { path: ['LLM_MAX_TOKENS'], value: '-7' },
  ]);
  await f.edit('panel.env', [
    { path: ['HOST'], value: 'operator-host' },
    { path: ['METADATA_INSTANCES_CONFIG'], value: '/operator/instances.json' },
    { path: ['KNOWLEDGE_SERVICE_URL'], value: 'independent-panel-knowledge' },
  ]);
  const expected = await readNativeDocuments(f.project);
  const saved = await captureNativeConfiguration(f.project);
  const input = resolveSettings(await readInstallationEnv(f.project));
  assert.equal(input.CORE_API_KEY, '');
  assert.equal(input.MEMORY_LLM_MAX_TOKENS, '-1');
  assert.equal(input.MEMORY_PROXY_PUBLIC_URL, '');
  assert.equal(input.KNOWLEDGE_PUBLIC_URL, '');
  const candidate = await f.prepare({}, input);
  assert.deepEqual(candidate.documents, expected);
  await saveNativeConfiguration(f.project, candidate);
  assert.equal(await captureNativeConfiguration(f.project), saved);
  await stageNativeRuntime(f.project, candidate, input);
  const staged = JSON.parse(await readFile(join(f.project, '.ams/native-runtime.json'), 'utf8'));
  assert.deepEqual(staged.documents, expected);
  assert.equal(value(staged.documents['core.yaml']).llm.baseUrl, 'custom+scheme://operator/model/');
  assert.equal(value(staged.documents['core.yaml']).llm.apiKey, ' key with surrounding spaces ');
  assert.equal(value(staged.documents['proxy.yaml']).tdai.apiKey, 'independent-proxy-key');
  assert.equal(value(staged.documents['proxy.yaml']).storage.sqlite.dbPath, '/operator/proxy.db');
  assert.equal(parseNativeDocument(staged.documents['knowledge.env'], 'env').LLM_BASE_URL, 'independent-knowledge-model/');
  assert.equal(parseNativeDocument(staged.documents['panel.env'], 'env').KNOWLEDGE_SERVICE_URL, 'independent-panel-knowledge');
  assert.equal(staged.runtimeConfigs['core-env.json'], undefined);
  const generated = await generate(f.project);
  for (const [name, text] of Object.entries(expected)) assert.equal(await readFile(join(generated.generated, name), 'utf8'), text);
});

test('native deletion and empty values do not regain AMS defaults through the settings view', async t => {
  const f = await fixture(t);
  await f.edit('core.yaml', [{ path: ['memory', 'promptMode'], delete: true }]);
  await f.edit('proxy.yaml', [{ path: ['injection', 'externalGatewayUrl'], delete: true }]);
  await f.edit('knowledge.env', [{ path: ['KNOWLEDGE_PUBLIC_BASE_URL'], delete: true }]);
  await writeFile(join(f.root, 'overrides/deletions.json'), JSON.stringify({
    'core.yaml': ['/llm/maxTokens', '/memory/promptMode'],
    'proxy.yaml': ['/injection/externalGatewayUrl'],
    'knowledge.env': ['/LLM_MAX_TOKENS', '/KNOWLEDGE_PUBLIC_BASE_URL'],
  }));
  await f.edit('core.yaml', [{ path: ['llm', 'timeoutMs'], value: null }]);
  const input = resolveSettings(await readInstallationEnv(f.project));
  for (const name of ['MEMORY_LLM_MAX_TOKENS', 'MEMORY_PROMPT_MODE', 'MEMORY_PROXY_PUBLIC_URL', 'KNOWLEDGE_LLM_MAX_TOKENS', 'KNOWLEDGE_PUBLIC_URL']) assert.equal(Object.hasOwn(input, name), false);
  assert.equal(input.MEMORY_LLM_TIMEOUT_MS, '');
  const candidate = await f.prepare({}, input);
  assert.equal(value(candidate.documents['core.yaml']).llm.timeoutMs, null);
  await stageNativeRuntime(f.project, candidate, input);
  const staged = JSON.parse(await readFile(join(f.project, '.ams/native-runtime.json'), 'utf8'));
  assert.deepEqual(staged.documents, candidate.documents);
});

test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access in native unit test'); }));
