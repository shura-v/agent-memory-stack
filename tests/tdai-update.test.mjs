import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeEnv } from '../dist/config/files.js';
import { loadSourceLock, packageRoot } from '../dist/build/sources.js';
import { getNativeTemplates } from '../dist/config/native-templates.js';
import { updateTdai } from '../dist/build/update-tdai.js';
import { createNativeSourceFixture } from './fixtures/native-source.mjs';

const fixture = createNativeSourceFixture();
const { source, bytes, files } = fixture;
const { revision, url } = source;
const coreEnv = {
  CORE_API_KEY: 'synthetic-core-key', CLIPROXY_API_KEY: 'synthetic-cliproxy-key', KNOWLEDGE_LLM_MODEL: 'wiki-model',
  LLM_BASE_URL: 'https://llm.test/v1', LLM_API_KEY: 'synthetic-llm-key', MEMORY_LLM_MODEL: 'memory-model',
};

async function installation(t, env = coreEnv) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-tdai-update-'));
  process.env.XDG_CONFIG_HOME = join(directory, 'xdg');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '.env'), encodeEnv(env));
  return directory;
}

test('TDAI update stages the branch commit and downloaded digest only in the installation', async t => {
  const directory = await installation(t);
  const packagedBefore = await readFile(join(packageRoot, 'upstream.lock.json'), 'utf8');
  const packaged = JSON.parse(packagedBefore);
  const requests = [];
  const result = await updateTdai(directory, { fetchImpl: async (address, options) => {
    requests.push(address);
    assert.ok(options.signal instanceof AbortSignal);
    return requests.length === 1 ? Response.json({ sha: revision }) : new Response(bytes);
  } });
  assert.deepEqual(requests, [
    'https://api.github.com/repos/TencentCloud/TencentDB-Agent-Memory/commits/feat%2Fserver_team', url,
  ]);
  assert.deepEqual(result, { previousRevision: packaged.sources.tencent.revision, revision });
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.ams/pending-tdai-source.json'), 'utf8')), source);
  assert.deepEqual(await readFile(join(directory, `.ams-build/.cache/upstream/tencent-${revision}.tar.gz`)), bytes);
  const effective = await loadSourceLock(directory);
  assert.deepEqual(effective.sources.tencent, packaged.sources.tencent);
  assert.deepEqual((await getNativeTemplates(directory, source)).files, files);
  await assert.rejects(readFile(join(directory, '.ams/native-templates', revision, 'core.yaml')), { code: 'ENOENT' });
  assert.deepEqual(effective.sources.cliproxy, packaged.sources.cliproxy);
  assert.deepEqual(effective.images, packaged.images);
  assert.equal(await readFile(join(packageRoot, 'upstream.lock.json'), 'utf8'), packagedBefore);
  const snapshot = JSON.parse(await readFile(join(directory, '.ams/before-save.json'), 'utf8'));
  assert.equal(snapshot['.env'], encodeEnv(coreEnv));
  assert.equal(snapshot['.ams/tdai-source.json'], null);
});

test('TDAI update preserves the prior pin for apply rollback', async t => {
  const directory = await installation(t);
  await mkdir(join(directory, '.ams'));
  const previous = { ...source, revision: 'b'.repeat(40), url: url.replace(revision, 'b'.repeat(40)) };
  const previousRaw = JSON.stringify(previous);
  await writeFile(join(directory, '.ams/tdai-source.json'), previousRaw);
  let request = 0;
  const result = await updateTdai(directory, { fetchImpl: async () => ++request === 1 ? Response.json({ sha: revision }) : new Response(bytes) });
  assert.equal(result.previousRevision, previous.revision);
  const snapshot = JSON.parse(await readFile(join(directory, '.ams/before-save.json'), 'utf8'));
  assert.equal(snapshot['.ams/tdai-source.json'], previousRaw);
});

test('network and invalid GitHub responses preserve existing TDAI metadata', async t => {
  for (const failure of ['api', 'sha', 'download', 'throw']) {
    await t.test(failure, async t => {
      const directory = await installation(t);
      await mkdir(join(directory, '.ams'));
      const original = JSON.stringify(source);
      await writeFile(join(directory, '.ams/tdai-source.json'), original);
      let requests = 0;
      await assert.rejects(updateTdai(directory, { fetchImpl: async () => {
        requests++;
        if (failure === 'throw') throw new Error('untrusted upstream error body');
        if (failure === 'api' || requests === 2) return new Response('upstream failure', { status: 503 });
        return Response.json({ sha: failure === 'sha' ? '../invalid' : revision });
      } }), error => /saved source selection was not changed/.test(error.message) && !/untrusted/.test(error.message));
      assert.equal(await readFile(join(directory, '.ams/tdai-source.json'), 'utf8'), original);
      await assert.rejects(readFile(join(directory, '.ams/before-save.json')), { code: 'ENOENT' });
    });
  }
});

test('TDAI update reads settings without value checks but still requires readable files', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('', { status: 503 }); };
  const directory = await installation(t);
  await writeFile(join(directory, '.env'), 'LLM_API_KEY=\nPANEL_PORT=custom\n');
  await assert.rejects(updateTdai(directory, { fetchImpl }), /Could not download/);
  assert.equal(calls, 1);
  await rm(join(directory, '.env'));
  await assert.rejects(updateTdai(directory, { fetchImpl }), { code: 'ENOENT' });
  assert.equal(calls, 1);
});

test('source loader falls back only for a missing pin and rejects malformed overrides', async t => {
  const directory = await installation(t);
  assert.deepEqual(await loadSourceLock(directory), await loadSourceLock());
  await mkdir(join(directory, '.ams'));
  const path = join(directory, '.ams/tdai-source.json');
  for (const value of ['{', 'null', JSON.stringify({ ...source, revision: '../invalid' }),
    JSON.stringify({ ...source, sha256: 'bad' }), JSON.stringify({ ...source, url: 'https://attacker.test/archive' }),
    JSON.stringify({ ...source, url: url + '?other=source' })]) {
    await writeFile(path, value);
    await assert.rejects(loadSourceLock(directory), /Invalid .ams\/tdai-source.json/);
  }
  await rm(path);
  await mkdir(path);
  await assert.rejects(loadSourceLock(directory));
});


test('update rejects a downloaded archive missing native defaults before staging metadata', async t => {
  const directory = await installation(t);
  await mkdir(join(directory, '.ams'));
  const previous = JSON.stringify(source);
  await writeFile(join(directory, '.ams/tdai-source.json'), previous);
  const incomplete = createNativeSourceFixture({ revision: 'c'.repeat(40), files: { 'panel.env': undefined } });
  let request = 0;
  await assert.rejects(updateTdai(directory, { fetchImpl: async () => ++request === 1
    ? Response.json({ sha: incomplete.source.revision }) : new Response(incomplete.bytes) }), /Missing or duplicate native template/);
  assert.equal(await readFile(join(directory, '.ams/tdai-source.json'), 'utf8'), previous);
  await assert.rejects(readFile(join(directory, '.ams/pending-tdai-source.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(directory, '.ams/before-save.json')), { code: 'ENOENT' });
});
