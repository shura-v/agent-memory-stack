import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fetchSources, loadSourceLock, packageRoot } from '../dist/build/sources.js';
import { imageServices, prepareBuildContext, validateImageManifest, validateDeploymentImages } from '../dist/build/images.js';
import { exportImages, loadImages, runtimePlatform } from '../dist/build/bundle.js';
import { buildFingerprint, buildFingerprintLabel, contextPackageJson } from '../dist/build/fingerprint.js';
import { prepareImages } from '../dist/setup/images.js';

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

test('a tampered cached archive fails before extraction or patch execution', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'ams-build-tamper-'));
  try {
    const lock = JSON.parse(await readFile(resolve(packageRoot, 'upstream.lock.json'), 'utf8'));
    const cache = resolve(project, '.ams-build/.cache/upstream');
    await mkdir(cache, { recursive: true });
    await writeFile(resolve(cache, `tencent-${lock.sources.tencent.revision}.tar.gz`), 'corrupted archive');
    await assert.rejects(fetchSources(project), /archive SHA-256 mismatch/);
    await assert.rejects(readFile(resolve(cache, 'tencent/package.json')), { code: 'ENOENT' });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('placement preflight requires its image subset while validating any additional identities', () => {
  const identity = { id: `sha256:${'a'.repeat(64)}`, tag: 'local', repoDigests: [], platform: 'linux/arm64' };
  const manifest = { schemaVersion: 1, images: { runtime: { ...identity }, 'cli-proxy-api': { ...identity } } };
  assert.equal(validateDeploymentImages(manifest, ['runtime', 'cli-proxy-api'], 'linux/arm64'), manifest);
  assert.throws(() => validateDeploymentImages(manifest, ['runtime', 'core']), /Missing image: core/);
  assert.throws(() => validateDeploymentImages(manifest, ['runtime'], 'linux/amd64'), /Incompatible image platform/);
  manifest.images.core = { ...identity, id: 'mutable-tag-only' };
  assert.throws(() => validateDeploymentImages(manifest, ['runtime']), /Invalid image identity: core/);
});

test('build context uses installed package resources, not caller files or secrets', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'ams-build-context-'));
  try {
    await writeFile(resolve(project, '.env'), 'SYNTHETIC_SECRET=do-not-copy');
    await mkdir(resolve(project, 'deploy'));
    await writeFile(resolve(project, 'deploy/node.Dockerfile'), 'caller-controlled Dockerfile');
    const context = await prepareBuildContext(project);
    assert.match(await readFile(resolve(context, 'deploy/node.Dockerfile'), 'utf8'), /^FROM docker.io\/library\/node:/);
    await assert.rejects(readFile(resolve(context, '.env')), { code: 'ENOENT' });
    assert.match(await readFile(resolve(context, 'dist/runtime/environment.js'), 'utf8'), /AMS_ENV_FILE/);
    await assert.rejects(readFile(resolve(context, 'dist/runtime/environment.js.map')), { code: 'ENOENT' });
    assert.equal(await readFile(resolve(context, 'package.json'), 'utf8'), contextPackageJson);
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

test('checksum-valid image archive missing a declared content identity is rejected before load', { skip: process.env.AMS_IMAGE_LOAD_TEST !== '1' }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ams-bundle-identity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = process.env.AMS_CONTAINER_ENGINE ?? 'podman';
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(directory, 'config.json'), '{}');
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify([{ Config: 'config.json' }]));
  execFileSync('tar', ['-cf', resolve(directory, 'images.tar'), '-C', directory, 'manifest.json', 'config.json']);
  const manifest = { schemaVersion: 1, images: { core: { id: `sha256:${'a'.repeat(64)}`, tag: 'synthetic', repoDigests: [], platform: runtimePlatform(runtime) } } };
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(resolve(directory, 'images.json'), manifestBytes);
  await writeFile(resolve(directory, 'bundle.json'), JSON.stringify({ schemaVersion: 1, archiveSha256: sha(await readFile(resolve(directory, 'images.tar'))), manifestSha256: sha(manifestBytes) }));
  await assert.rejects(loadImages({ bundleDir: directory, projectDir: directory, runtime }), /Archive is missing the configured image: core/);
  await assert.rejects(readFile(resolve(directory, '.ams/images.json')), { code: 'ENOENT' });
});

test('build fingerprints follow packaged bytes and remain stable across directories, docs, secrets and source maps', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'ams-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['deploy', 'dist/runtime', 'dist/config', 'dist/deployment', 'dist/build', 'dist/patches', 'patches', 'upstream.lock.json']) {
    await mkdir(resolve(root, path, '..'), { recursive: true });
    await cp(resolve(packageRoot, path), resolve(root, path), { recursive: true });
  }
  const hashes = Object.fromEntries(await Promise.all(imageServices.map(async service => [service, await buildFingerprint(service, root)])));
  for (const service of imageServices) assert.equal(hashes[service], await buildFingerprint(service), service);
  await writeFile(resolve(root, '.env'), 'LLM_API_KEY=synthetic-secret');
  await writeFile(resolve(root, 'README.md'), 'Different documentation');
  await writeFile(resolve(root, 'package.json'), '{"version":"999.0.0"}');
  await writeFile(resolve(root, 'dist/runtime/environment.js.map'), 'different machine source map');
  for (const service of imageServices) assert.equal(hashes[service], await buildFingerprint(service, root), service);
  const config = resolve(root, 'dist/config/settings.js');
  await writeFile(config, (await readFile(config, 'utf8')) + '\n// newly supported env field\n');
  assert.notEqual(hashes.runtime, await buildFingerprint('runtime', root));
  assert.equal(hashes.core, await buildFingerprint('core', root));
  const patch = resolve(root, 'patches/ams-access.ts');
  await writeFile(patch, (await readFile(patch, 'utf8')) + '\n// new upstream adaptation\n');
  assert.notEqual(hashes['memory-proxy'], await buildFingerprint('memory-proxy', root));
  assert.equal(hashes['cli-proxy-api'], await buildFingerprint('cli-proxy-api', root));
  const lock = resolve(root, 'upstream.lock.json');
  await writeFile(lock, (await readFile(lock, 'utf8')) + '\n');
  assert.notEqual(hashes['cli-proxy-api'], await buildFingerprint('cli-proxy-api', root));
});

test('installation TDAI pins change only the four TDAI image fingerprints', async t => {
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
    if (['core', 'knowledge', 'panel', 'memory-proxy'].includes(service)) assert.notEqual(hashes[0], hashes[1], service);
    else {
      assert.equal(hashes[0], hashes[1], service);
      assert.equal(hashes[0], await buildFingerprint(service), service);
    }
  }
});

async function bundleFixture(t, { pinned = true, service = 'core', services = [service] } = {}) {
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
  const source = pinned ? { revision: 'a'.repeat(40), sha256: 'b'.repeat(64),
    url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${'a'.repeat(40)}` }
    : (await loadSourceLock()).sources.tencent;
  if (pinned) await writeFile(resolve(project, '.ams/tdai-source.json'), JSON.stringify(source));
  const manifest = { schemaVersion: 1, images: {} };
  const inspections = {};
  const entries = [];
  for (const selected of services) {
    const fingerprint = await buildFingerprint(selected, undefined, project);
    const config = { config: { Labels: { 'org.opencontainers.image.revision': source.revision, [buildFingerprintLabel]: fingerprint } } };
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
  return { root, project, destination, output, source, manifest, inspection, inspections, calls };
}

test('export/load retains installation TDAI source and reuses imported images offline', async t => {
  const f = await bundleFixture(t);
  const previous = (await loadSourceLock()).sources.tencent;
  await writeFile(resolve(f.destination, '.ams/tdai-source.json'), JSON.stringify(previous));
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  assert.deepEqual(JSON.parse(await readFile(resolve(f.output, 'tdai-source.json'), 'utf8')), f.source);
  await loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' });
  assert.equal((await loadSourceLock(f.destination)).sources.tencent.revision, f.source.revision);
  assert.equal((await loadSourceLock(f.destination)).sources.tencent.sha256, f.source.sha256);
  const before = JSON.parse(await readFile(resolve(f.destination, '.ams/before-save.json'), 'utf8'));
  assert.equal(JSON.parse(before['.ams/tdai-source.json']).revision, previous.revision);
  const prepared = await prepareImages({ projectDir: f.destination, runtime: 'docker', services: ['core'] }, {
    run: async command => command.args[0] === 'info'
      ? JSON.stringify({ OSType: 'linux', Architecture: 'arm64' }) : JSON.stringify([f.inspection]),
    build: async () => assert.fail('Imported matching source must not trigger a rebuild or network fetch'),
  });
  assert.deepEqual(prepared, f.manifest);
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

test('legacy bundle without source metadata accepts only a verified packaged revision', async t => {
  for (const pinned of [true, false]) {
    await t.test(pinned ? 'unknown updated source is rejected' : 'packaged source is restored', async t => {
      const f = await bundleFixture(t, { pinned });
      await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
      const metadataPath = resolve(f.output, 'bundle.json');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      delete metadata.tdaiSourceSha256;
      await writeFile(metadataPath, JSON.stringify(metadata));
      await rm(resolve(f.output, 'tdai-source.json'));
      if (pinned) {
        await assert.rejects(loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' }), /source selection does not match bundled image/);
        assert.ok(!(await readFile(f.calls, 'utf8')).includes('["load"'));
      } else {
        await loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' });
        assert.equal((await loadSourceLock(f.destination)).sources.tencent.revision, f.source.revision);
      }
    });
  }
});

test('export rejects a source changed after the recorded images were built', async t => {
  const f = await bundleFixture(t);
  const source = { ...f.source, revision: 'd'.repeat(40), url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${'d'.repeat(40)}` };
  await writeFile(resolve(f.project, '.ams/tdai-source.json'), JSON.stringify(source));
  await assert.rejects(exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' }), /source selection does not match bundled image/);
  assert.ok(!(await readFile(f.calls, 'utf8')).includes('["save"'));
});

test('bundle without TDAI images retains destination source selection', async t => {
  const f = await bundleFixture(t, { service: 'runtime' });
  const bytes = JSON.stringify(f.source);
  await writeFile(resolve(f.destination, '.ams/tdai-source.json'), bytes);
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  assert.equal(JSON.parse(await readFile(resolve(f.output, 'bundle.json'), 'utf8')).tdaiSourceSha256, undefined);
  await loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' });
  assert.equal(await readFile(resolve(f.destination, '.ams/tdai-source.json'), 'utf8'), bytes);
});

test('configured export excludes stale inactive images while retaining helper runtime and TDAI pin', async t => {
  const f = await bundleFixture(t, { services: ['core', 'runtime'] });
  const saved = structuredClone(f.manifest);
  const stalePanel = `sha256:${'c'.repeat(64)}`;
  saved.images.panel = { id: stalePanel, tag: 'old-panel', repoDigests: [], platform: 'linux/amd64' };
  const original = JSON.stringify(saved);
  await writeFile(resolve(f.project, '.ams/images.json'), original);
  await writeFile(resolve(f.project, '.env'), 'AMS_DEPLOYMENT_VERSION=1\nAMS_SERVICES=core\n');
  await exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' });
  assert.deepEqual(JSON.parse(await readFile(resolve(f.output, 'images.json'), 'utf8')), f.manifest);
  assert.equal(await readFile(resolve(f.project, '.ams/images.json'), 'utf8'), original);
  assert.ok(!(await readFile(f.calls, 'utf8')).includes(stalePanel), 'inactive image is neither inspected nor saved');
  assert.deepEqual(JSON.parse(await readFile(resolve(f.output, 'tdai-source.json'), 'utf8')), f.source);
  const loaded = await loadImages({ bundleDir: f.output, projectDir: f.destination, runtime: 'docker' });
  const prepared = await prepareImages({ projectDir: f.destination, runtime: 'docker', services: ['core', 'runtime'] }, {
    run: async command => command.args[0] === 'info'
      ? JSON.stringify({ OSType: 'linux', Architecture: 'arm64' }) : JSON.stringify([f.inspections[command.args[2]]]),
    build: async () => assert.fail('Selected imported images must remain reusable offline'),
  });
  assert.deepEqual(prepared, loaded);
  assert.deepEqual(Object.keys(loaded.images), ['core', 'runtime']);
});

test('configured export requires helper images and rejects invalid topology before engine calls', async t => {
  const f = await bundleFixture(t);
  for (const [env, message] of [
    ['AMS_DEPLOYMENT_VERSION=1\nAMS_SERVICES=core\n', /Missing image: runtime/],
    ['AMS_DEPLOYMENT_VERSION=1\nAMS_SERVICES=unknown\n', /unknown or duplicate service names/],
  ]) {
    await writeFile(resolve(f.project, '.env'), env);
    await assert.rejects(exportImages({ projectDir: f.project, outputDir: f.output, runtime: 'docker' }), message);
    await assert.rejects(readFile(f.calls), { code: 'ENOENT' });
  }
});
