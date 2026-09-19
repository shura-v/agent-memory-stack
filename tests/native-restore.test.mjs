import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNativeConfiguration, saveNativeConfiguration, stageNativeRuntime, orchestrationEnv, captureNativeConfiguration } from '../dist/config/native-state.js';
import { parseNativeDocument, updateNativeDocument } from '../dist/config/native-documents.js';
import { resolveSettings } from '../dist/config/settings.js';
import { encodeEnv } from '../dist/config/files.js';
import { captureInputs, recordAppliedInputs } from '../dist/setup/server-settings.js';
import { restoreNativeSnapshot } from '../dist/runtime/restore-native.js';
import { snapshotSettings } from '../dist/runtime/snapshot.js';
import { applyServer } from '../dist/setup/server.js';
import { installNativeSourceFixture } from './fixtures/native-source.mjs';
import { loadSourceLock } from '../dist/build/sources.js';

const imageSet = digit => ({ schemaVersion: 1, images: Object.fromEntries(['core', 'knowledge', 'panel', 'memory-proxy', 'mcp', 'cli-proxy-api', 'runtime'].map(name => [name, { id: 'sha256:' + digit.repeat(64), tag: name + ':test', repoDigests: [], platform: 'linux/arm64' }])) });
async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'ams-native-restore-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = join(temporary, 'runtime'), snapshot = join(temporary, 'snapshot'), root = join(temporary, 'native');
  await mkdir(join(directory, '.ams'), { recursive: true });
  const env = resolveSettings({ CORE_API_KEY: 'synthetic-core-key', CLIPROXY_API_KEY: 'synthetic-cliproxy-key', LLM_BASE_URL: 'https://synthetic.invalid/v1', LLM_API_KEY: 'synthetic-provider-key', MEMORY_LLM_MODEL: 'model', KNOWLEDGE_LLM_MODEL: 'model' });
  const { source } = await installNativeSourceFixture(directory);
  const images = imageSet('a');
  const candidate = await prepareNativeConfiguration(directory, env, { root });
  await saveNativeConfiguration(directory, candidate);
  await stageNativeRuntime(directory, candidate, env);
  await writeFile(join(directory, '.env'), encodeEnv(orchestrationEnv(env)));
  await writeFile(join(directory, '.ams/tdai-source.json'), JSON.stringify(source));
  await writeFile(join(directory, '.ams/images.json'), JSON.stringify(images));
  await writeFile(join(directory, 'compose.yaml'), '# coherent old compose\n');
  await recordAppliedInputs(directory, await captureInputs(directory));
  await snapshotSettings(directory);
  const oldInputs = JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'));
  if (oldInputs['.ams/native-backup.json'] !== null) await writeFile(join(directory, '.ams/previous-settings/.ams/native-backup.json'), oldInputs['.ams/native-backup.json']);
  await cp(join(directory, '.ams/previous-settings'), snapshot, { recursive: true });
  const restoredNative = await captureNativeConfiguration(directory);
  // Model a later successful generation followed by a failed update attempt.
  {
    await writeFile(join(root, 'overrides/core.yaml'), updateNativeDocument(await readFile(join(root, 'overrides/core.yaml'), 'utf8'), 'yaml', [{ path: ['newerOperatorSetting'], value: 'newer' }]));
    await writeFile(join(root, 'overrides/deletions.json'), '{"core.yaml":["/abandonedOptionalSetting"]}\n');
  }
  await writeFile(join(directory, '.ams/last-applied-inputs.json'), JSON.stringify({ ...oldInputs, '.env': 'NEWER=secret\n', '.ams/native-backup.json': await captureNativeConfiguration(directory) }));
  await writeFile(join(directory, '.ams/before-save.json'), 'stale');
  await writeFile(join(directory, '.ams/pending-tdai-source.json'), JSON.stringify({ revision: 'b'.repeat(40), url: 'https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/' + 'b'.repeat(40), sha256: 'b'.repeat(64) }));
  await writeFile(join(directory, '.ams/pending-images.json'), JSON.stringify(imageSet('b')));
  await writeFile(join(directory, '.ams/native-runtime.json'), '{"generation":"newer"}');
  return { directory, snapshot, root, env, source, images, oldInputs, restoredNative };
}

test('explicit native restore cancels abandoned update and resets protected applied-input provenance', async t => {
  const f = await fixture(t);
  await restoreNativeSnapshot(f.directory, f.snapshot);
  assert.equal(await captureNativeConfiguration(f.directory), f.restoredNative);
  const recorded = JSON.parse(await readFile(join(f.directory, '.ams/last-applied-inputs.json'), 'utf8'));
  assert.deepEqual(recorded, f.oldInputs);
  assert.equal((await stat(join(f.directory, '.ams/last-applied-inputs.json'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(f.directory, '.ams/native-runtime.json'), 'utf8'), f.oldInputs['.ams/native-runtime.json']);
  for (const name of ['pending-tdai-source.json', 'pending-images.json', 'before-save.json', 'apply-pending']) await assert.rejects(stat(join(f.directory, '.ams', name)), { code: 'ENOENT' });
  assert.equal((await loadSourceLock(f.directory)).sources.tencent.revision, f.source.revision);
});

test('native restore ignores unsupported metadata fields', async t => {
  const f = await fixture(t);
  const backup = JSON.parse(await readFile(join(f.snapshot, '.ams/native-backup.json'), 'utf8'));
  const reference = JSON.parse(await readFile(join(f.snapshot, '.ams/native-config.json'), 'utf8'));
  await writeFile(join(f.snapshot, '.ams/native-backup.json'), JSON.stringify({ ...backup, operatorNotes: 'war and peace' }));
  await writeFile(join(f.snapshot, '.ams/native-config.json'), JSON.stringify({ ...reference, operatorNotes: 'war and peace' }));
  await restoreNativeSnapshot(f.directory, f.snapshot);
  assert.equal(await captureNativeConfiguration(f.directory), f.restoredNative);
});

test('next failed apply uses restored revision and keeps a coherent restored rollback snapshot', async t => {
  const f = await fixture(t);
  await restoreNativeSnapshot(f.directory, f.snapshot);
  // Operator begins another desired edit after rollback. Recovery must still retain
  // the restored applied version, not this edit or the abandoned newer generation.
  await writeFile(join(f.directory, '.env'), (await readFile(join(f.directory, '.env'), 'utf8')) + 'LOG_LEVEL="debug"\n');
  const ui = { interactive: false, note() {}, async confirm() { assert.fail('unexpected prompt'); }, async handoff() { assert.fail('unexpected bootstrap'); } };
  let startup = false;
  await assert.rejects(applyServer(ui, f.directory, {
    nativeRoot: f.root,
    prepareImages: async ({ source }) => { assert.equal(source, undefined, 'abandoned pending target must not be selected'); return f.images; },
    runtime: () => ({ checkProvider: async () => {}, preflight: async () => ({ pending: [] }), snapshot: async () => snapshotSettings(f.directory), apply: async () => { startup = true; throw new Error('synthetic startup failure'); } }),
  }), /synthetic startup failure/);
  assert.equal(startup, true);
  const rollback = join(f.directory, '.ams/previous-settings');
  assert.equal(await readFile(join(rollback, '.env'), 'utf8'), f.oldInputs['.env']);
  assert.equal(await readFile(join(rollback, '.ams/native-backup.json'), 'utf8'), f.restoredNative);
  assert.equal(await readFile(join(rollback, '.ams/tdai-source.json'), 'utf8'), f.oldInputs['.ams/tdai-source.json']);
  assert.deepEqual(JSON.parse(await readFile(join(rollback, '.ams/images.json'), 'utf8')), f.images);
  assert.equal(await readFile(join(rollback, 'compose.yaml'), 'utf8'), '# coherent old compose\n');
});

test('TDAI restore rejects a missing native backup without changing active configuration or candidates', async t => {
  const f = await fixture(t);
  await rm(join(f.snapshot, '.ams/native-backup.json'));
  const before = await captureNativeConfiguration(f.directory);
  const reference = await readFile(join(f.directory, '.ams/native-config.json'), 'utf8');
  const inputs = await readFile(join(f.directory, '.ams/last-applied-inputs.json'), 'utf8');
  await assert.rejects(restoreNativeSnapshot(f.directory, f.snapshot), /missing native configuration/);
  assert.equal(await captureNativeConfiguration(f.directory), before);
  assert.equal(await readFile(join(f.directory, '.ams/native-config.json'), 'utf8'), reference);
  assert.equal(await readFile(join(f.directory, '.ams/last-applied-inputs.json'), 'utf8'), inputs);
  await stat(join(f.directory, '.ams/pending-tdai-source.json'));
});

test('native restore requires the snapshot reference to match the native backup', async t => {
  const f = await fixture(t);
  await rm(join(f.snapshot, '.ams/native-config.json'));
  const before = await captureNativeConfiguration(f.directory);
  await assert.rejects(restoreNativeSnapshot(f.directory, f.snapshot), /native-config\.json|Invalid native configuration snapshot/);
  assert.equal(await captureNativeConfiguration(f.directory), before);
});

test('mismatched restore keeps pending target and previous provenance untouched', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, '.ams/images.json'), JSON.stringify(imageSet('b')));
  const before = await readFile(join(f.directory, '.ams/last-applied-inputs.json'), 'utf8');
  await assert.rejects(restoreNativeSnapshot(f.directory, f.snapshot), /matching source and image records/);
  assert.equal(await readFile(join(f.directory, '.ams/last-applied-inputs.json'), 'utf8'), before);
  await stat(join(f.directory, '.ams/pending-tdai-source.json'));
  await stat(join(f.directory, '.ams/apply-pending'));
});

test('snapshot round-trip preserves both sets, deletion bytes, source/reference records and effective settings', async t => {
  const f = await fixture(t);
  const backup = JSON.parse(f.restoredNative);
  assert.equal(Object.keys(backup.defaults).length, 5);
  assert.equal(Object.keys(backup.overrides).length, 5);
  assert.equal(Object.hasOwn(backup, 'state'), false);
  assert.equal(Object.hasOwn(backup, 'originsFinalized'), false);
  assert.deepEqual(JSON.parse(await readFile(join(f.snapshot, '.ams/tdai-source.json'), 'utf8')), f.source);
  assert.deepEqual(JSON.parse(await readFile(join(f.snapshot, '.ams/native-config.json'), 'utf8')), {
    version: 1, root: f.root, originsFinalized: true,
  });
  const deletionText = '{\n  "core.yaml": ["/optionalRemovedSetting"]\n}\n';
  backup.deletions = deletionText;
  await writeFile(join(f.snapshot, '.ams/native-backup.json'), JSON.stringify(backup));
  await writeFile(join(f.root, 'overrides/panel.env'), 'UNSAVED_OPTION=value\n');
  await restoreNativeSnapshot(f.directory, f.snapshot);
  assert.equal(await readFile(join(f.root, 'overrides/deletions.json'), 'utf8'), deletionText);
  assert.equal(await readFile(join(f.root, 'overrides/panel.env'), 'utf8'), backup.overrides['panel.env']);
  const restored = JSON.parse(await captureNativeConfiguration(f.directory));
  assert.deepEqual(restored, backup);
  assert.equal((await stat(join(f.root, 'overrides/core.yaml'))).mode & 0o777, 0o600);
  const candidate = await prepareNativeConfiguration(f.directory, f.env, { root: f.root });
  assert.deepEqual(candidate.defaults, backup.defaults);
  assert.deepEqual(candidate.overrides, backup.overrides);
  assert.equal(candidate.deletions, deletionText);
});

test('incomplete or corrupt two-set snapshots fail before replacing any active bytes', async t => {
  for (const mutate of [
    saved => { delete saved.defaults['panel.env']; },
    saved => { saved.overrides['proxy.yaml'] = '[invalid'; },
    saved => { saved.deletions = '{"unknown.yaml":["/field"]}'; },
  ]) {
    const f = await fixture(t);
    const before = await captureNativeConfiguration(f.directory);
    const saved = JSON.parse(f.restoredNative);
    mutate(saved);
    await writeFile(join(f.snapshot, '.ams/native-backup.json'), JSON.stringify(saved));
    await assert.rejects(restoreNativeSnapshot(f.directory, f.snapshot));
    assert.equal(await captureNativeConfiguration(f.directory), before);
    await stat(join(f.directory, '.ams/pending-tdai-source.json'));
  }
});

test('invalid snapshot reference fails before replacing any active bytes', async t => {
  for (const reference of [
    { version: 1, root: '/missing-origins' },
    { version: 1, root: '/different-root', originsFinalized: true },
  ]) {
    const f = await fixture(t);
    const before = await captureNativeConfiguration(f.directory);
    await writeFile(join(f.snapshot, '.ams/native-config.json'), JSON.stringify(reference));
    await assert.rejects(restoreNativeSnapshot(f.directory, f.snapshot), /native-config\.json|snapshot reference/);
    assert.equal(await captureNativeConfiguration(f.directory), before);
    await stat(join(f.directory, '.ams/pending-tdai-source.json'));
  }
});

test('explicit restore adopts an occupied root without an active reference', async t => {
  const f = await fixture(t);
  const expected = JSON.parse(f.restoredNative);
  const unrelatedState = '{"source":"unrelated"}\n';
  await writeFile(join(f.root, '.ams-state.json'), unrelatedState);
  await writeFile(join(f.root, 'overrides/core.yaml'), 'changed: after-snapshot\n');
  await rm(join(f.directory, '.ams/native-config.json'));
  await restoreNativeSnapshot(f.directory, f.snapshot);
  assert.equal(await readFile(join(f.root, 'overrides/core.yaml'), 'utf8'), expected.overrides['core.yaml']);
  assert.deepEqual(JSON.parse(await readFile(join(f.directory, '.ams/native-config.json'), 'utf8')), {
    version: 1, root: f.root, originsFinalized: true,
  });
  assert.equal(await readFile(join(f.root, '.ams-state.json'), 'utf8'), unrelatedState);
});

test('native restore rejects absent or invalid matching image records before replacing either set', async t => {
  for (const images of [undefined, { schemaVersion: 1, images: {} }]) {
    const f = await fixture(t);
    const before = await captureNativeConfiguration(f.directory);
    for (const directory of [f.directory, f.snapshot]) {
      if (images === undefined) await rm(join(directory, '.ams/images.json'));
      else await writeFile(join(directory, '.ams/images.json'), JSON.stringify(images));
    }
    await assert.rejects(restoreNativeSnapshot(f.directory, f.snapshot), /missing source or image records|Missing image/);
    assert.equal(await captureNativeConfiguration(f.directory), before);
  }
});


test('native restore preserves operator values without checking service policy', async t => {
  const f = await fixture(t);
  const backup = JSON.parse(f.restoredNative);
  const changes = {
    'core.yaml': { 'server.port': 9000, 'data.baseDir': '/custom/data', 'llm.model': '', 'llm.maxTokens': -1, 'llm.timeoutMs': 0, 'llm.baseUrl': 'operator-model/' },
    'proxy.yaml': { 'admin.apiKey': '', 'tdai.endpoint': 'operator-core', 'tdai.apiKey': 'independent-key' },
    'knowledge.env': { API_PREFIX: '/custom', PORT: 'operator-port', LLM_BASE_URL: 'independent-model', LLM_MAX_TOKENS: '-1' },
    'panel.env': { METADATA_INSTANCES_CONFIG: '/custom/instances.json' },
  };
  for (const [name, edits] of Object.entries(changes)) backup.overrides[name] = updateNativeDocument(backup.overrides[name], name.endsWith('.yaml') ? 'yaml' : 'env', Object.entries(edits).map(([path, value]) => ({ path: path.split('.'), value })));
  await writeFile(join(f.snapshot, '.ams/native-backup.json'), JSON.stringify(backup));
  await restoreNativeSnapshot(f.directory, f.snapshot);
  assert.deepEqual(JSON.parse(await captureNativeConfiguration(f.directory)), backup);
  const candidate = await prepareNativeConfiguration(f.directory, f.env);
  await stageNativeRuntime(f.directory, candidate, f.env);
  const staged = JSON.parse(await readFile(join(f.directory, '.ams/native-runtime.json'), 'utf8'));
  assert.equal(parseNativeDocument(staged.documents['proxy.yaml'], 'yaml').admin.apiKey, '');
  assert.equal(parseNativeDocument(staged.documents['knowledge.env'], 'env').API_PREFIX, '/custom');
  assert.equal(parseNativeDocument(staged.documents['core.yaml'], 'yaml').llm.baseUrl, 'operator-model/');
  assert.equal(parseNativeDocument(staged.documents['proxy.yaml'], 'yaml').tdai.endpoint, 'operator-core');
  assert.equal(staged.runtimeConfigs['proxy-env.json'], undefined);
});

test.beforeEach(t => t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network access in native unit test'); }));
