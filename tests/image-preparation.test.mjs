import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { imageServices } from '../dist/build/images.js';
import { prepareImages } from '../dist/setup/images.js';
import { buildFingerprint, buildFingerprintLabel } from '../dist/build/fingerprint.js';

const identity = (digit = 'a', platform = 'linux/amd64') => ({
  id: `sha256:${digit.repeat(64)}`, tag: 'agent-memory-stack/core:local', repoDigests: [], platform,
});
const manifest = images => ({ schemaVersion: 1, images });
const fullImages = (platform = 'linux/amd64') => Object.fromEntries(imageServices.map((service, index) => [service, { ...identity(String(index + 1), platform), tag: `agent-memory-stack/${service}:local` }]));
const indexed = images => Object.fromEntries(Object.values(images).map(image => [image.id, image]));

async function directory(t, metadata) {
  const path = await mkdtemp(join(tmpdir(), 'ams-image-preparation-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  if (metadata !== undefined) {
    await mkdir(join(path, '.ams'));
    await writeFile(join(path, '.ams/images.json'), typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
  }
  return path;
}

function engine(images = {}, { runtime = 'docker', arch = 'amd64', os = 'linux', fingerprints = {} } = {}) {
  const calls = [];
  return {
    calls,
    run: async ({ command, args }) => {
      calls.push({ command, args });
      assert.equal(command, runtime);
      if (args[0] === 'info') return JSON.stringify(runtime === 'docker' ? { OSType: os, Architecture: arch } : { host: { os, arch } });
      assert.deepEqual(args.slice(0, 2), ['image', 'inspect']);
      const image = images[args[2]];
      if (!image) throw new Error('image missing');
      const fingerprint = Object.hasOwn(fingerprints, image.id) ? fingerprints[image.id] : await buildFingerprint(image.tag.split('/')[1].split(':')[0]);
      return JSON.stringify([{ Id: image.id, Os: image.platform.split('/')[0], Architecture: image.platform.split('/')[1],
        Config: { Labels: fingerprint === null ? {} : { [buildFingerprintLabel]: fingerprint } } }]);
    },
  };
}

test('fresh setup builds the complete stack and returns metadata without activating it', async t => {
  const projectDir = await directory(t);
  const runtime = engine({}, { arch: 'aarch64' });
  const images = fullImages('linux/arm64');
  const result = await prepareImages({ projectDir, runtime: 'docker' }, {
    run: runtime.run,
    build: async options => {
      assert.deepEqual(options.services, imageServices);
      assert.equal(options.platform, 'linux/arm64');
      assert.equal(options.persist, false);
      return manifest(images);
    },
  });
  assert.deepEqual(result, manifest(images));
  await assert.rejects(readFile(join(projectDir, '.ams/images.json')), { code: 'ENOENT' });
});

test('verified full-stack images are reused by immutable identity', async t => {
  const images = fullImages(), metadata = manifest(images);
  const projectDir = await directory(t, metadata);
  const runtime = engine(indexed(images), { runtime: 'podman', arch: 'x86_64' });
  const result = await prepareImages({ projectDir, runtime: 'podman' }, {
    run: runtime.run, build: async () => assert.fail('matching images must not rebuild'),
  });
  assert.deepEqual(result, metadata);
  assert.equal(runtime.calls.filter(call => call.args[0] === 'image').length, imageServices.length);
});

test('only missing images rebuild while preparation retains the complete stack and active metadata', async t => {
  const images = fullImages(), metadata = manifest(images);
  const projectDir = await directory(t, metadata);
  const original = await readFile(join(projectDir, '.ams/images.json'), 'utf8');
  const available = indexed(images); delete available[images.panel.id]; delete available[images.runtime.id];
  const result = await prepareImages({ projectDir, runtime: 'docker' }, {
    run: engine(available).run,
    build: async options => {
      assert.deepEqual(options.services, ['panel', 'runtime']);
      assert.equal(options.persist, false);
      return options.manifest;
    },
  });
  assert.deepEqual(result, metadata);
  assert.equal(await readFile(join(projectDir, '.ams/images.json'), 'utf8'), original);
});

test('malformed or incompatible saved metadata fails before build', async t => {
  for (const metadata of ['{broken', manifest({ core: { ...identity(), id: 'mutable-tag' } }), manifest({ core: identity('a', 'linux/arm64') })]) {
    const projectDir = await directory(t, metadata);
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker' }, {
      run: engine().run,
      build: async () => assert.fail('invalid metadata must not trigger a build'),
    }), /Cannot reuse image metadata/);
  }
});

test('unavailable engine and unsupported platforms produce actionable errors without building', async t => {
  const projectDir = await directory(t);
  for (const [run, message] of [
    [async () => { throw new Error('socket unavailable'); }, /Start Docker.*docker info/],
    [engine({}, { os: 'windows' }).run, /Unsupported docker engine platform: windows\/amd64/],
    [engine({}, { arch: 'riscv64' }).run, /Use a Linux amd64 or arm64 container engine/],
  ]) {
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker' }, { run, build: async () => assert.fail('no build') }), message);
  }
});

test('image identity or platform mismatch fails instead of trusting saved metadata', async t => {
  const image = identity();
  const projectDir = await directory(t, manifest({ core: image }));
  for (const actual of [identity('b'), identity('a', 'linux/arm64')]) {
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker' }, {
      run: engine({ [image.id]: actual }).run,
      build: async () => assert.fail('mismatched identities must not rebuild silently'),
    }), /Image verification failed for core/);
  }
});

test('engine outage during image inspection does not trigger a build', async t => {
  const projectDir = await directory(t, manifest({ core: identity() }));
  let calls = 0;
  await assert.rejects(prepareImages({ projectDir, runtime: 'docker' }, {
    run: async () => { if (++calls === 1) return JSON.stringify({ OSType: 'linux', Architecture: 'amd64' }); throw new Error('engine disconnected'); },
    build: async () => assert.fail('no build after engine outage'),
  }), /Cannot read docker engine information/);
});

test('an incomplete builder result is rejected', async t => {
  const projectDir = await directory(t);
  await assert.rejects(prepareImages({ projectDir, runtime: 'docker' }, { run: engine().run, build: async () => manifest({}) }), /Missing image: core/);
});

test('outdated runtime rebuilds alone and current imported images remain reusable', async t => {
  const images = fullImages(), metadata = manifest(images);
  const projectDir = await directory(t, metadata);
  const original = await readFile(join(projectDir, '.ams/images.json'), 'utf8');
  for (const fingerprint of [null, 'sha256:' + '0'.repeat(64)]) {
    const fake = engine(indexed(images), { fingerprints: { [images.runtime.id]: fingerprint } });
    await prepareImages({ projectDir, runtime: 'docker' }, {
      run: fake.run,
      build: async options => { assert.deepEqual(options.services, ['runtime']); return options.manifest; },
    });
    assert.equal(await readFile(join(projectDir, '.ams/images.json'), 'utf8'), original);
  }
  assert.deepEqual(await prepareImages({ projectDir, runtime: 'docker' }, {
    run: engine(indexed(images)).run, build: async () => assert.fail('current labels survive export/import'),
  }), metadata);
});

test('changing an installation TDAI revision rebuilds its services and stock MCP while preserving AMS runtime and CLIProxyAPI', async t => {
  const services = ['core', 'knowledge', 'panel', 'memory-proxy', 'cli-proxy-api', 'mcp', 'runtime'];
  const images = Object.fromEntries(services.map((service, index) => [service, identity(String(index + 1))]));
  const projectDir = await directory(t, manifest(images));
  const writePin = async digit => {
    const revision = digit.repeat(40);
    await writeFile(join(projectDir, '.ams/tdai-source.json'), JSON.stringify({
      revision, url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${revision}`, sha256: digit.repeat(64),
    }));
  };
  await writePin('a');
  const fingerprints = Object.fromEntries(await Promise.all(services.map(async service => [
    images[service].id, await buildFingerprint(service, undefined, projectDir),
  ])));
  const fake = engine(Object.fromEntries(Object.values(images).map(image => [image.id, image])), { fingerprints });
  await prepareImages({ projectDir, runtime: 'docker' }, {
    run: fake.run, build: async () => assert.fail('matching installation pin must reuse images'),
  });
  await writePin('b');
  let builds = 0;
  const result = await prepareImages({ projectDir, runtime: 'docker' }, {
    run: fake.run,
    build: async options => {
      builds++;
      assert.deepEqual(options.services, ['core', 'knowledge', 'panel', 'memory-proxy', 'mcp']);
      assert.equal(options.projectDir, projectDir);
      return options.manifest;
    },
  });
  assert.equal(builds, 1);
  for (const service of ['cli-proxy-api', 'runtime']) assert.deepEqual(result.images[service], images[service]);
});
