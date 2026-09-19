import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeFileNames, extractNativeTemplates, getNativeTemplates } from '../dist/config/native-templates.js';
import { prepareNativeConfiguration, saveNativeConfiguration, captureNativeConfiguration } from '../dist/config/native-state.js';
import { createNativeSourceFixture, installNativeSourceFixture } from './fixtures/native-source.mjs';
const hash = data => createHash('sha256').update(data).digest('hex');
async function temporary(t) { const directory = await mkdtemp(join(tmpdir(), 'ams-templates-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const archivePath = (directory, source) => join(directory, '.ams-build/.cache/upstream', `tencent-${source.revision}.tar.gz`);

test('synthetic source fixtures produce deterministic archive bytes and metadata', () => {
  const first = createNativeSourceFixture(), second = createNativeSourceFixture();
  assert.deepEqual(first.bytes, second.bytes);
  assert.deepEqual(first.source, second.source);
});

test('verified archive extraction preserves all five original bytes and records their hashes', async t => {
  const directory = await temporary(t), fixture = await installNativeSourceFixture(directory);
  const set = await extractNativeTemplates(archivePath(directory, fixture.source), fixture.source);
  assert.deepEqual(set.files, fixture.files);
  assert.deepEqual(Object.keys(set.files), nativeFileNames);
  for (const name of nativeFileNames) assert.equal(hash(set.files[name]), set.manifest.templates[name].sha256);
  await assert.rejects(extractNativeTemplates(archivePath(directory, fixture.source), { ...fixture.source, sha256: 'b'.repeat(64) }), /SHA-256 mismatch/);
});

test('a missing selected-source template rejects extraction', async t => {
  const directory = await temporary(t), fixture = createNativeSourceFixture({ files: { 'proxy.yaml': undefined } });
  await installNativeSourceFixture(directory, fixture);
  await assert.rejects(getNativeTemplates(directory), /Missing or duplicate.*proxy.yaml/);
});

test('wrong archive revision rejects extraction even with a matching content checksum', async t => {
  const directory = await temporary(t), fixture = await installNativeSourceFixture(directory);
  const revision = 'c'.repeat(40);
  await assert.rejects(extractNativeTemplates(archivePath(directory, fixture.source), { ...fixture.source, revision, url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${revision}` }), /Missing or duplicate/);
});

test('cached acquisition is offline and corrupted cache is never replaced silently', async t => {
  const directory = await temporary(t), fixture = await installNativeSourceFixture(directory);
  t.mock.method(globalThis, 'fetch', () => assert.fail('verified cache must avoid network'));
  assert.deepEqual((await getNativeTemplates(directory)).files, fixture.files);
  await writeFile(archivePath(directory, fixture.source), 'corrupted archive');
  await assert.rejects(getNativeTemplates(directory), /SHA-256 mismatch/);
});

test('initial native preparation downloads only the selected archive and writes flat defaults on save', async t => {
  const directory = await temporary(t), fixture = createNativeSourceFixture();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(String(url)); return new Response(fixture.bytes); });
  const root = join(directory, 'native');
  const candidate = await prepareNativeConfiguration(directory, {}, { root, source: fixture.source });
  assert.deepEqual(calls, [fixture.source.url]);
  assert.deepEqual(candidate.defaults, fixture.files);
  await assert.rejects(readFile(join(root, '.ams-state.json')), { code: 'ENOENT' });
  await saveNativeConfiguration(directory, candidate);
  assert.deepEqual((await readdir(join(root, 'defaults'))).sort(), [...nativeFileNames].sort());
  for (const name of nativeFileNames) assert.equal(await readFile(join(root, 'defaults', name), 'utf8'), fixture.files[name]);
  await assert.rejects(readFile(join(root, '.ams-state.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.ams/native-config.json'), 'utf8')), {
    version: 1, root, originsFinalized: true,
  });
  const backup = JSON.parse(await captureNativeConfiguration(directory));
  assert.equal(Object.hasOwn(backup, 'state'), false);
  assert.equal(Object.hasOwn(backup, 'originsFinalized'), false);
  await assert.rejects(readdir(join(directory, '.ams/native-templates')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(archivePath(directory, fixture.source)), fixture.bytes);
});

test('ordinary preparation reuses saved defaults without reading source cache or downloading', async t => {
  const directory = await temporary(t), fixture = await installNativeSourceFixture(directory);
  const root = join(directory, 'native');
  await saveNativeConfiguration(directory, await prepareNativeConfiguration(directory, {}, { root }));
  const before = await captureNativeConfiguration(directory);
  await rm(join(directory, '.ams-build'), { recursive: true });
  t.mock.method(globalThis, 'fetch', () => assert.fail('ordinary apply must not acquire sources'));
  const candidate = await prepareNativeConfiguration(directory, {});
  assert.deepEqual(candidate.defaults, fixture.files);
  await saveNativeConfiguration(directory, candidate);
  assert.equal(await captureNativeConfiguration(directory), before);
});

test('failed new-source acquisition preserves the saved configuration and does not create defaults', async t => {
  const directory = await temporary(t), initial = await installNativeSourceFixture(directory);
  const root = join(directory, 'native');
  await saveNativeConfiguration(directory, await prepareNativeConfiguration(directory, {}, { root }));
  const before = await captureNativeConfiguration(directory);
  const next = createNativeSourceFixture({ revision: 'b'.repeat(40) });
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(prepareNativeConfiguration(directory, {}, { source: next.source }), /HTTP 503/);
  assert.equal(await captureNativeConfiguration(directory), before);
  assert.deepEqual((await prepareNativeConfiguration(directory, {})).defaults, initial.files);
  const fresh = join(directory, 'fresh');
  await assert.rejects(prepareNativeConfiguration(fresh, {}, { root: join(fresh, 'native'), source: next.source }), /HTTP 503/);
  await assert.rejects(readdir(join(fresh, 'native')), { code: 'ENOENT' });
});

test('download integrity failure cannot replace the current defaults', async t => {
  const directory = await temporary(t);
  await installNativeSourceFixture(directory);
  await saveNativeConfiguration(directory, await prepareNativeConfiguration(directory, {}, { root: join(directory, 'native') }));
  const before = await captureNativeConfiguration(directory);
  const next = createNativeSourceFixture({ revision: 'b'.repeat(40) });
  t.mock.method(globalThis, 'fetch', async () => new Response('different bytes'));
  await assert.rejects(prepareNativeConfiguration(directory, {}, { source: next.source }), /SHA-256 mismatch/);
  assert.equal(await captureNativeConfiguration(directory), before);
});


test('ordinary preparation preserves operator defaults and explicit source replacement installs new defaults', async t => {
  const directory = await temporary(t);
  const initial = await installNativeSourceFixture(directory);
  await saveNativeConfiguration(directory, await prepareNativeConfiguration(directory, {}, { root: join(directory, 'native') }));
  const next = createNativeSourceFixture({ revision: 'b'.repeat(40), files: { 'core.yaml': '# new selected source\nnewOption: true\n' } });
  await installNativeSourceFixture(directory, next);
  t.mock.method(globalThis, 'fetch', () => assert.fail('both selected archives are cached'));
  const ordinary = await prepareNativeConfiguration(directory, {});
  assert.deepEqual(ordinary.source, next.source);
  assert.deepEqual(ordinary.defaults, initial.files);
  await saveNativeConfiguration(directory, ordinary);
  const replacement = await prepareNativeConfiguration(directory, {}, { source: next.source });
  assert.deepEqual(replacement.defaults, next.files);
  assert.notDeepEqual(replacement.defaults, initial.files);
  await saveNativeConfiguration(directory, replacement);
  assert.deepEqual(JSON.parse(await captureNativeConfiguration(directory)).defaults, next.files);
});
