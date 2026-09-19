import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { acquireSourceArchive, cacheSourceArchive, fetchSources, loadSourceLock, packageRoot, validateTdaiSource } from '../dist/build/sources.js';
import { imageServices, prepareBuildContext, validateImageManifest, validateDeploymentImages } from '../dist/build/images.js';
import { exportImages, loadImages } from '../dist/build/bundle.js';
import { buildFingerprint, buildFingerprintLabel } from '../dist/build/fingerprint.js';
import { prepareImages } from '../dist/setup/images.js';
import { setupServer } from '../dist/setup/server.js';
import { getNativeTemplates } from '../dist/config/native-templates.js';
import { prepareNativeConfiguration, saveNativeConfiguration } from '../dist/config/native-state.js';
import { createNativeSourceFixture, installNativeSourceFixture } from './fixtures/native-source.mjs';

test('deployment manifest rejects incomplete and mixed-architecture image sets', () => {
  assert.throws(() => validateImageManifest({ schemaVersion: 1, images: [] }, false), /Invalid image manifest/);
  const images = Object.fromEntries(imageServices.map(service => [service, { id: `sha256:${'a'.repeat(64)}`, tag: service, repoDigests: [], platform: 'linux/arm64' }]));
  assert.equal(validateImageManifest({ schemaVersion: 1, images }).images.core.platform, 'linux/arm64');
  assert.throws(() => validateImageManifest({ schemaVersion: 1, images }, true, 'linux/amd64'), /Incompatible/);
  images.panel.platform = 'linux/amd64';
  assert.throws(() => validateImageManifest({ schemaVersion: 1, images }), /Incompatible/);
  delete images.panel;
  assert.throws(() => validateImageManifest({ schemaVersion: 1, images }), /Missing image: panel/);
});

test('a tampered cached archive fails before extraction', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'ams-build-tamper-'));
  try {
    const lock = JSON.parse(await readFile(resolve(packageRoot, 'vendor/upstream.lock.json'), 'utf8'));
    const cache = resolve(project, '.ams-build/.cache/upstream');
    await mkdir(cache, { recursive: true });
    await writeFile(resolve(cache, `tencent-${lock.sources.tencent.revision}.tar.gz`), 'corrupted archive');
    await assert.rejects(fetchSources(project), /archive SHA-256 mismatch/);
    await assert.rejects(readFile(resolve(cache, 'tencent/package.json')), { code: 'ENOENT' });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('verified source preparation preserves source and dependency bytes and replaces modified prepared trees', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'ams-stock-sources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = resolve(root, 'installation');
  const packageDirectory = resolve(root, 'package');
  const original = resolve(root, 'archive/source');
  const cache = resolve(project, '.ams-build/.cache/upstream');
  const files = {
    'MemoryCore/package.json': '{"dependencies":{"native-addon":"^1.0.0"},"peerDependencies":{"upstream-peer":"*"}}\n',
    'MemoryCore/src/gateway/server.ts': '// Original upstream implementation\nexport const version = "stock";\n',
    'MemoryKnowledge/package.json': '{"scripts":{"build":"tsdown"}}\n',
    'MemoryKnowledge/.npmrc': 'legacy-peer-deps=true\n',
    'MemoryPanel/package.json': '{"name":"stock-panel"}\n',
    'MemoryPanel/package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
    'MemoryPanel/web/package.json': '{"name":"stock-panel-web"}\n',
    'MemoryPanel/web/package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
    'MemoryProxy/package.json': '{"name":"stock-proxy"}\n',
    'MemoryProxy/package-lock.json': '{"lockfileVersion":3,"packages":{}}\n',
    'MemoryProxy/src/index.ts': 'if (process.versions.node.split(".")[0] !== "22") process.exit(1);\n',
  };
  for (const [name, value] of Object.entries(files)) {
    await mkdir(resolve(original, name, '..'), { recursive: true });
    await writeFile(resolve(original, name), value);
  }
  await mkdir(cache, { recursive: true });
  await mkdir(resolve(packageDirectory, 'vendor'), { recursive: true });
  const revision = 'a'.repeat(40);
  const archive = resolve(cache, `tencent-${revision}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', resolve(original, '..'), 'source']);
  const source = { revision, url: 'https://example.invalid/never-downloaded',
    sha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
  await writeFile(resolve(packageDirectory, 'vendor/upstream.lock.json'), JSON.stringify({ sources: { tencent: source }, images: {} }));
  const prepared = resolve(cache, 'tencent');
  for (let attempt = 0; attempt < 2; attempt++) {
    await mkdir(resolve(prepared, 'MemoryProxy/src'), { recursive: true });
    await writeFile(resolve(prepared, 'MemoryProxy/src/injected.ts'), 'abandoned local adaptation');
    await writeFile(resolve(prepared, 'MemoryProxy/package.json'), '{"dependencies":{"replacement":"1.0.0"}}');
    assert.equal(await fetchSources(project, packageDirectory), cache);
    for (const name of Object.keys(files)) {
      assert.deepEqual(await readFile(resolve(prepared, name)), await readFile(resolve(original, name)), name);
    }
    await assert.rejects(readFile(resolve(prepared, 'MemoryProxy/src/injected.ts')), { code: 'ENOENT' });
    await prepareBuildContext(project);
    for (const name of Object.keys(files)) {
      assert.deepEqual(await readFile(resolve(prepared, name)), await readFile(resolve(original, name)), `build context: ${name}`);
    }
  }
});

test('TDAI build recipe uses stock dependency metadata and stock service entrypoints', async () => {
  const recipe = (await readFile(resolve(packageRoot, 'deploy/node.Dockerfile'), 'utf8')).split('# AMS owns the HTTP boundary')[0];
  assert.match(recipe, /^FROM docker.io\/library\/node:22-bookworm-slim@sha256:[a-f0-9]{64} AS base$/m);
  assert.doesNotMatch(recipe, /deploy\/locks|dist\/runtime|dist\/build|AMS_ENV_FILE|ams-integration|npm pkg|npm install --save/);
  for (const service of ['MemoryCore', 'MemoryKnowledge', 'MemoryPanel', 'MemoryPanel/web', 'MemoryProxy']) {
    assert.ok(recipe.includes(`COPY .cache/upstream/tencent/${service}/ ./`), service);
  }
  assert.match(recipe, /"--import", "tsx", "src\/gateway\/server.ts"/);
  assert.match(recipe, /"--import", "tsx\/esm", "src\/index.ts"/);
  assert.match(recipe, /"node", "dist\/server.mjs"/);
  assert.match(recipe, /"node", "dist\/index.js"/);
  for (const directory of ['core', 'knowledge', 'panel', 'panel-web', 'proxy']) {
    await assert.rejects(readFile(resolve(packageRoot, `deploy/locks/${directory}/package.json`)), { code: 'ENOENT' });
  }
  const mcpRecipe = (await readFile(resolve(packageRoot, 'deploy/node.Dockerfile'), 'utf8')).split('# AMS owns the HTTP boundary')[1];
  assert.match(mcpRecipe, /COPY package\.json package-lock\.json/);
  assert.doesNotMatch(mcpRecipe, /supergateway|bind-loopback|vendor\/mcp/);
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.ok(manifest.dependencies['@modelcontextprotocol/sdk']);
  assert.ok(!manifest.dependencies.supergateway && !manifest.devDependencies.supergateway);
});

test('source acquisition downloads once and rejects corrupt cache without substituting bytes', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'ams-source-acquisition-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = createNativeSourceFixture();
  let downloads = 0;
  const fetchImpl = async address => { downloads++; assert.equal(address, fixture.source.url); return new Response(fixture.bytes); };
  const archive = await acquireSourceArchive(root, 'tencent', fixture.source, { fetchImpl });
  assert.deepEqual(await readFile(archive), fixture.bytes);
  assert.equal(await acquireSourceArchive(root, 'tencent', fixture.source, { fetchImpl }), archive);
  assert.equal(downloads, 1);
  await writeFile(archive, 'corrupted cached archive');
  await assert.rejects(acquireSourceArchive(root, 'tencent', fixture.source, { fetchImpl }), /SHA-256 mismatch/);
  assert.equal(downloads, 1);
  assert.equal(await readFile(archive, 'utf8'), 'corrupted cached archive');
  await rm(archive);
  await assert.rejects(acquireSourceArchive(root, 'tencent', fixture.source, { fetchImpl: async () => new Response('wrong bytes') }), /SHA-256 mismatch/);
  await assert.rejects(readFile(archive), { code: 'ENOENT' });
});

test('deployment validation always requires all seven images', () => {
  const identity = { id: `sha256:${'a'.repeat(64)}`, tag: 'local', repoDigests: [], platform: 'linux/arm64' };
  const manifest = { schemaVersion: 1, images: Object.fromEntries(imageServices.map(name => [name, { ...identity }])) };
  assert.equal(validateDeploymentImages(manifest, 'linux/arm64'), manifest);
  assert.throws(() => validateDeploymentImages(manifest, 'linux/amd64'), /Incompatible image platform/);
  delete manifest.images.panel;
  assert.throws(() => validateDeploymentImages(manifest), /Missing image: panel/);
});

test('build context uses installed package resources, not caller files or secrets', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'ams-build-context-'));
  try {
    await writeFile(resolve(project, '.env'), 'SYNTHETIC_SECRET=do-not-copy');
    await mkdir(resolve(project, 'deploy'));
    await writeFile(resolve(project, 'deploy/node.Dockerfile'), 'caller-controlled Dockerfile');
    const context = await prepareBuildContext(project);
    assert.match(await readFile(resolve(context, 'deploy/node.Dockerfile'), 'utf8'), /^FROM docker.io\/library\/node:22-bookworm-slim@sha256:/m);
    for (const path of ['package.json', 'package-lock.json', 'vendor/upstream.lock.json'])
      assert.deepEqual(await readFile(resolve(context, path)), await readFile(resolve(packageRoot, path)), path);
    await assert.rejects(readFile(resolve(context, '.env')), { code: 'ENOENT' });
    assert.match(await readFile(resolve(context, 'dist/runtime/config.js'), 'utf8'), /readInstallationEnv/);
    await assert.rejects(readFile(resolve(context, 'dist/runtime/config.js.map')), { code: 'ENOENT' });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('damaged image bundle is rejected before contacting the container runtime', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'ams-bundle-tamper-'));
  try {
    await writeFile(resolve(project, 'bundle.json'), JSON.stringify({ schemaVersion: 1, archiveSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) }));
    await writeFile(resolve(project, 'images.tar'), 'corrupted archive');
    await assert.rejects(loadImages({ bundleDir: project, projectDir: project, runtime: 'docker' }), /checksum mismatch/);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('checksum-valid image archive missing a declared content identity is rejected before engine use', async t => {
  const f = await bundleFixture(t);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  const beforeCalls = await readFile(f.calls, 'utf8');
  const manifest = JSON.parse(await readFile(resolve(f.output, 'images.json'), 'utf8'));
  manifest.images.core.id = `sha256:${'f'.repeat(64)}`;
  const bytes = JSON.stringify(manifest);
  await writeFile(resolve(f.output, 'images.json'), bytes);
  const metadata = JSON.parse(await readFile(resolve(f.output, 'bundle.json'), 'utf8'));
  metadata.manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(f.output, 'bundle.json'), JSON.stringify(metadata));
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /Archive is missing the configured image: core/);
  assert.equal(await readFile(f.calls, 'utf8'), beforeCalls);
  await assert.rejects(readFile(resolve(f.destination, '.ams/pending-images.json')), { code: 'ENOENT' });
});

test('build fingerprints follow packaged bytes and remain stable across directories, docs, secrets and source maps', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'ams-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['deploy', 'vendor', 'dist/runtime', 'dist/config', 'dist/deployment', 'dist/build', 'package.json', 'package-lock.json']) {
    await mkdir(resolve(root, path, '..'), { recursive: true });
    await cp(resolve(packageRoot, path), resolve(root, path), { recursive: true });
  }
  const hashes = Object.fromEntries(await Promise.all(imageServices.map(async service => [service, await buildFingerprint(service, root)])));
  for (const service of imageServices) assert.equal(hashes[service], await buildFingerprint(service), service);
  await writeFile(resolve(root, '.env'), 'LLM_API_KEY=synthetic-secret');
  await writeFile(resolve(root, 'README.md'), 'Different documentation');
  await writeFile(resolve(root, 'dist/runtime/config.js.map'), 'different machine source map');
  for (const service of imageServices) assert.equal(hashes[service], await buildFingerprint(service, root), service);
  const manifest = resolve(root, 'package.json');
  const originalManifest = await readFile(manifest, 'utf8');
  await writeFile(manifest, originalManifest + '\n');
  for (const service of ['runtime', 'mcp']) assert.notEqual(hashes[service], await buildFingerprint(service, root));
  assert.equal(hashes.core, await buildFingerprint('core', root));
  await writeFile(manifest, originalManifest);
  const dependencies = resolve(root, 'dist/build/package-lock.json');
  await writeFile(dependencies, (await readFile(dependencies, 'utf8')) + '\n');
  assert.notEqual(hashes.mcp, await buildFingerprint('mcp', root));
  assert.equal(hashes.runtime, await buildFingerprint('runtime', root));
  const config = resolve(root, 'dist/config/settings.js');
  await writeFile(config, (await readFile(config, 'utf8')) + '\n// newly supported env field\n');
  assert.notEqual(hashes.runtime, await buildFingerprint('runtime', root));
  assert.equal(hashes.core, await buildFingerprint('core', root));
  const recipe = resolve(root, 'deploy/node.Dockerfile');
  await writeFile(recipe, (await readFile(recipe, 'utf8')) + '\n# Updated stock build recipe\n');
  assert.notEqual(hashes['memory-proxy'], await buildFingerprint('memory-proxy', root));
  assert.equal(hashes['cli-proxy-api'], await buildFingerprint('cli-proxy-api', root));
  const lock = resolve(root, 'vendor/upstream.lock.json');
  await writeFile(lock, (await readFile(lock, 'utf8')) + '\n');
  assert.notEqual(hashes['cli-proxy-api'], await buildFingerprint('cli-proxy-api', root));
});

test('installation TDAI pins change the four services and stock MCP fingerprints', async t => {
  const first = await mkdtemp(resolve(tmpdir(), 'ams-first-source-'));
  const second = await mkdtemp(resolve(tmpdir(), 'ams-second-source-'));
  t.after(() => Promise.all([first, second].map(path => rm(path, { recursive: true, force: true }))));
  for (const service of imageServices) {
    assert.equal(await buildFingerprint(service, undefined, first), await buildFingerprint(service));
  }
  for (const [directory, digit] of [[first, 'a'], [second, 'b']]) {
    await mkdir(resolve(directory, '.ams'));
    const revision = digit.repeat(40);
    await writeFile(resolve(directory, '.ams/tdai-source.json'), JSON.stringify({
      revision, url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${revision}`, sha256: digit.repeat(64),
    }));
  }
  for (const service of imageServices) {
    const hashes = await Promise.all([first, second].map(directory => buildFingerprint(service, undefined, directory)));
    if (['core', 'knowledge', 'panel', 'memory-proxy', 'mcp'].includes(service)) assert.notEqual(hashes[0], hashes[1], service);
    else {
      assert.equal(hashes[0], hashes[1], service);
      assert.equal(hashes[0], await buildFingerprint(service), service);
    }
  }
});

async function bundleFixture(t, { services = imageServices, revisionOverrides = {} } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'ams-source-bundle-'));
  const originalPath = process.env.PATH;
  t.after(async () => { process.env.PATH = originalPath; await rm(root, { recursive: true, force: true }); });
  const project = resolve(root, 'source');
  const destination = resolve(root, 'destination');
  const output = resolve(root, 'bundle');
  const bin = resolve(root, 'bin');
  await mkdir(resolve(project, '.ams'), { recursive: true });
  await mkdir(resolve(destination, '.ams'), { recursive: true });
  await mkdir(bin);
  const fixture = await installNativeSourceFixture(project);
  const { source, bytes, files } = fixture;
  const templates = await getNativeTemplates(project, source);
  const manifest = { schemaVersion: 1, images: {} };
  const inspections = {};
  const entries = [];
  for (const selected of services) {
    const fingerprint = await buildFingerprint(selected, undefined, project);
    const config = { config: { Labels: { 'org.opencontainers.image.revision': revisionOverrides[selected] ?? source.revision, [buildFingerprintLabel]: fingerprint } } };
    const configBytes = JSON.stringify(config);
    const id = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
    manifest.images[selected] = { id, tag: `test-${selected}`, repoDigests: [], platform: 'linux/arm64' };
    const name = `${selected}-config.json`;
    await writeFile(resolve(root, name), configBytes);
    entries.push({ Config: name });
    inspections[id] = { Id: id, Os: 'linux', Architecture: 'arm64', Config: config.config };
  }
  await writeFile(resolve(project, '.ams/images.json'), JSON.stringify(manifest));
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(entries));
  const archive = resolve(root, 'fixture.tar');
  execFileSync('tar', ['-cf', archive, '-C', root, 'manifest.json', ...entries.map(entry => entry.Config)]);
  const inspection = inspections[manifest.images[services[0]].id];
  const calls = resolve(root, 'calls.jsonl');
  const fakeEngine = `#!${process.execPath}
import { appendFileSync, copyFileSync } from 'node:fs';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='info')process.stdout.write(JSON.stringify({OSType:'linux',Architecture:'arm64'}));
else if(args[0]==='image'&&args[1]==='inspect')process.stdout.write(JSON.stringify([${JSON.stringify(inspections)}[args[2]]]));
else if(args[0]==='save')copyFileSync(${JSON.stringify(archive)},args[args.indexOf('--output')+1]);
else if(args[0]!=='load')process.exitCode=1;
`;
  await writeFile(resolve(bin, 'docker'), fakeEngine);
  await chmod(resolve(bin, 'docker'), 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
  return { root, project, destination, output, source, manifest, inspection, inspections, calls, templates, bytes, files };
}

test('export/load stages TDAI source and images for offline apply without replacing active state', async t => {
  const f = await bundleFixture(t);
  const previous = (await loadSourceLock()).sources.tencent;
  await writeFile(resolve(f.destination, '.ams/tdai-source.json'), JSON.stringify(previous));
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  assert.deepEqual(JSON.parse(await readFile(resolve(f.output, 'tdai-source.json'), 'utf8')), f.source);
  assert.deepEqual(await readFile(resolve(f.output, 'tdai-source.tar.gz')), f.bytes);
  await assert.rejects(readFile(resolve(f.output, 'native-templates/manifest.json')), { code: 'ENOENT' });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Offline import/apply cannot download sources'));
  await loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' });
  assert.deepEqual((await loadSourceLock(f.destination)).sources.tencent, previous);
  assert.deepEqual(await getNativeTemplates(f.destination, f.source), f.templates);
  assert.deepEqual(JSON.parse(await readFile(resolve(f.destination, '.ams/pending-tdai-source.json'), 'utf8')), f.source);
  assert.deepEqual(JSON.parse(await readFile(resolve(f.destination, '.ams/pending-images.json'), 'utf8')), f.manifest);
  await assert.rejects(readFile(resolve(f.destination, '.ams/images.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(f.destination, '.ams/before-save.json')), { code: 'ENOENT' });
  const prepared = await prepareImages({ projectDir: f.destination, runtime: 'docker' }, {
    run: async command => command.args[0] === 'info'
      ? JSON.stringify({ OSType: 'linux', Architecture: 'arm64' }) : JSON.stringify([f.inspections[command.args[2]]]),
    build: async () => assert.fail('Imported matching source must not trigger a rebuild or network fetch'),
  });
  assert.deepEqual(prepared, f.manifest);
  const nativeRoot = resolve(f.root, 'native');
  const candidate = await prepareNativeConfiguration(f.destination, {}, { root: nativeRoot, source: f.source });
  await saveNativeConfiguration(f.destination, candidate);
  assert.deepEqual((await readdir(resolve(nativeRoot, 'defaults'))).sort(), Object.keys(f.files).sort());
  for (const [name, text] of Object.entries(f.files)) assert.equal(await readFile(resolve(nativeRoot, 'defaults', name), 'utf8'), text);
  await assert.rejects(readdir(resolve(f.destination, '.ams/native-templates')), { code: 'ENOENT' });
});

test('save-only Configure selects imported source only for a fresh installation', async t => {
  for (const baseline of ['fresh', 'active-pin', 'native-and-pin']) {
    await t.test(baseline, async t => {
      const f = await bundleFixture(t);
      const nativeRoot = resolve(f.root, 'native');
      const previous = createNativeSourceFixture({ revision: 'b'.repeat(40), files: { 'core.yaml': 'futureOption: existing-default\n' } });
      if (baseline !== 'fresh') {
        await installNativeSourceFixture(f.destination, previous);
        if (baseline !== 'active-pin') {
          const candidate = await prepareNativeConfiguration(f.destination, {}, { root: nativeRoot });
          await saveNativeConfiguration(f.destination, candidate);
        }
      }
      await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
      await loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' });
      t.mock.method(globalThis, 'fetch', async () => assert.fail('Offline Configure cannot download or discover models'));
      const engineCalls = await readFile(f.calls, 'utf8');
      const ui = {
        async select(_id, _message, options, initial) { return initial ?? options[0].value; },
        async text(question) { return question.initial ?? 'configured-model'; },
        async confirm(id, _message, initial) { return id === 'apply' ? false : initial; },
        note() {}, async handoff() { assert.fail('Configure cannot initialize Core'); },
      };
      await setupServer(ui, { directory: f.destination, nativeRoot,
        runtime: () => assert.fail('Save-only Configure cannot use an engine'),
        prepareImages: async () => assert.fail('Save-only Configure cannot build images'),
        listModels: async () => assert.fail('Local models need no provider discovery'),
      });
      const expected = baseline === 'fresh' ? f : previous;
      assert.deepEqual(validateTdaiSource((await loadSourceLock(f.destination)).sources.tencent), expected.source);
      for (const [name, text] of Object.entries(expected.files)) {
        assert.equal(await readFile(resolve(nativeRoot, 'defaults', name), 'utf8'), text, name);
      }
      assert.deepEqual((await readdir(resolve(nativeRoot, 'defaults'))).sort(), Object.keys(expected.files).sort());
      assert.deepEqual(JSON.parse(await readFile(resolve(f.destination, '.ams/pending-tdai-source.json'), 'utf8')), f.source);
      assert.deepEqual(JSON.parse(await readFile(resolve(f.destination, '.ams/pending-images.json'), 'utf8')), f.manifest);
      assert.equal(await readFile(f.calls, 'utf8'), engineCalls);
      await assert.rejects(readFile(resolve(f.destination, '.ams/images.json')), { code: 'ENOENT' });
    });
  }
});

test('bundle source corruption or invalid source metadata fails before engine use and preserves destination', async t => {
  const f = await bundleFixture(t);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  const destinationPin = resolve(f.destination, '.ams/tdai-source.json');
  await writeFile(destinationPin, 'unchanged-destination');
  const beforeCalls = await readFile(f.calls, 'utf8');
  await writeFile(resolve(f.output, 'tdai-source.json'), '{}');
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /source checksum mismatch/);
  const metadataPath = resolve(f.output, 'bundle.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.tdaiSourceSha256 = createHash('sha256').update('{}').digest('hex');
  await writeFile(metadataPath, JSON.stringify(metadata));
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /Invalid TDAI source/);
  assert.equal(await readFile(f.calls, 'utf8'), beforeCalls);
  assert.equal(await readFile(destinationPin, 'utf8'), 'unchanged-destination');
});

test('source metadata must match archived image revision before load', async t => {
  const f = await bundleFixture(t);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  const source = { ...f.source, revision: 'c'.repeat(40), url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${'c'.repeat(40)}` };
  const bytes = JSON.stringify(source);
  await writeFile(resolve(f.output, 'tdai-source.json'), bytes);
  const metadataPath = resolve(f.output, 'bundle.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.tdaiSourceSha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(metadataPath, JSON.stringify(metadata));
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /source selection does not match bundled image/);
  assert.ok(!(await readFile(f.calls, 'utf8')).includes('["load"'));
  await assert.rejects(readFile(resolve(f.destination, '.ams/tdai-source.json')), { code: 'ENOENT' });
});

test('TDAI bundle requires explicit source metadata before engine use', async t => {
  const f = await bundleFixture(t);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  const metadataPath = resolve(f.output, 'bundle.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  delete metadata.tdaiSourceSha256;
  await writeFile(metadataPath, JSON.stringify(metadata));
  await rm(resolve(f.output, 'tdai-source.json'));
  const beforeCalls = await readFile(f.calls, 'utf8');
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /requires source metadata/);
  assert.equal(await readFile(f.calls, 'utf8'), beforeCalls);
  await assert.rejects(readFile(resolve(f.destination, '.ams/pending-tdai-source.json')), { code: 'ENOENT' });
});

test('export verifies the stock MCP artifact revision before saving images', async t => {
  const f = await bundleFixture(t, { revisionOverrides: { mcp: 'b'.repeat(40) } });
  await assert.rejects(exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' }), /source selection does not match bundled image: mcp/);
  assert.ok(!(await readFile(f.calls, 'utf8')).includes('["save"'));
});

test('export rejects a source changed after the recorded images were built', async t => {
  const f = await bundleFixture(t);
  const source = { ...f.source, revision: 'd'.repeat(40), url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${'d'.repeat(40)}` };
  await writeFile(resolve(f.project, '.ams/tdai-source.json'), JSON.stringify(source));
  await assert.rejects(exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' }), /source selection does not match bundled image/);
  assert.ok(!(await readFile(f.calls, 'utf8')).includes('["save"'));
});

test('export rejects incomplete stacks before contacting the engine', async t => {
  for (const missing of imageServices) await t.test(missing, async t => {
    const f = await bundleFixture(t, { services: imageServices.filter(name => name !== missing) });
    await assert.rejects(exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' }), new RegExp(`Missing image: ${missing}`));
    await assert.rejects(readFile(f.calls), { code: 'ENOENT' });
  });
});

test('import rejects a checksum-valid incomplete manifest before contacting the engine', async t => {
  const f = await bundleFixture(t);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  const before = await readFile(f.calls, 'utf8');
  const manifest = structuredClone(f.manifest);
  delete manifest.images.panel;
  const bytes = JSON.stringify(manifest);
  await writeFile(resolve(f.output, 'images.json'), bytes);
  const metadata = JSON.parse(await readFile(resolve(f.output, 'bundle.json'), 'utf8'));
  metadata.manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(f.output, 'bundle.json'), JSON.stringify(metadata));
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /Missing image: panel/);
  assert.equal(await readFile(f.calls, 'utf8'), before);
});

test('checksum-valid source missing a native default is rejected before engine load', async t => {
  const f = await bundleFixture(t);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  const beforeCalls = await readFile(f.calls, 'utf8');
  const incomplete = createNativeSourceFixture({ files: { 'proxy.yaml': undefined } });
  await writeFile(resolve(f.output, 'tdai-source.tar.gz'), incomplete.bytes);
  const sourceBytes = JSON.stringify(incomplete.source);
  await writeFile(resolve(f.output, 'tdai-source.json'), sourceBytes);
  const metadataPath = resolve(f.output, 'bundle.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.tdaiSourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  await writeFile(metadataPath, JSON.stringify(metadata));
  await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /Missing or duplicate native template/);
  assert.equal(await readFile(f.calls, 'utf8'), beforeCalls);
  await assert.rejects(readFile(resolve(f.destination, '.ams/pending-tdai-source.json')), { code: 'ENOENT' });
});

test('corrupt or missing bundled source is rejected even with a matching local archive', async t => {
  for (const damage of ['corrupt', 'missing', 'wrong-provenance']) {
    await t.test(damage, async t => {
      const f = await bundleFixture(t);
      await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
      await cacheSourceArchive(f.destination, 'tencent', f.source, f.bytes);
      const beforeCalls = await readFile(f.calls, 'utf8');
      const archive = resolve(f.output, 'tdai-source.tar.gz');
      if (damage === 'missing') await rm(archive);
      else await writeFile(archive, damage === 'corrupt' ? 'corrupt archive' : createNativeSourceFixture({ revision: 'b'.repeat(40) }).bytes);
      t.mock.method(globalThis, 'fetch', async () => assert.fail('Offline bundle import must never fetch sources'));
      await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /SHA-256 mismatch|ENOENT/);
      assert.equal(await readFile(f.calls, 'utf8'), beforeCalls);
      for (const name of ['tdai-source.json', 'images.json', 'pending-tdai-source.json', 'pending-images.json']) {
        await assert.rejects(readFile(resolve(f.destination, '.ams', name)), { code: 'ENOENT' });
      }
    });
  }
});
