import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fetchSources, packageRoot } from '../dist/build/sources.js';
import { imageServices, prepareBuildContext, validateImageManifest, validateDeploymentImages } from '../dist/build/images.js';
import { loadImages, runtimePlatform } from '../dist/build/bundle.js';
import { buildFingerprint, contextPackageJson } from '../dist/build/fingerprint.js';

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
    await mkdir(resolve(project, 'docker'));
    await writeFile(resolve(project, 'docker/node.Dockerfile'), 'caller-controlled Dockerfile');
    const context = await prepareBuildContext(project);
    assert.match(await readFile(resolve(context, 'docker/node.Dockerfile'), 'utf8'), /^FROM docker.io\/library\/node:/);
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
  for (const path of ['docker', 'dist/runtime', 'dist/config', 'dist/deployment', 'dist/build', 'dist/patches', 'patches', 'upstream.lock.json']) {
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
