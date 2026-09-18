import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareImages } from '../dist/setup/images.js';
import { buildFingerprint, buildFingerprintLabel } from '../dist/build/fingerprint.js';

const identity = (digit = 'a', platform = 'linux/amd64') => ({
  id: `sha256:${digit.repeat(64)}`, tag: 'agent-memory-stack/core:local', repoDigests: [], platform,
});
const manifest = images => ({ schemaVersion: 1, images });

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
      const fingerprint = Object.hasOwn(fingerprints, image.id) ? fingerprints[image.id] : await buildFingerprint('core');
      return JSON.stringify([{ Id: image.id, Os: image.platform.split('/')[0], Architecture: image.platform.split('/')[1],
        Config: { Labels: fingerprint === null ? {} : { [buildFingerprintLabel]: fingerprint } } }]);
    },
  };
}

test('fresh setup builds only selected images using the engine platform and returns metadata in memory', async t => {
  const projectDir = await directory(t);
  const runtime = engine({}, { arch: 'aarch64' });
  const notes = [];
  let builds = 0;
  const result = await prepareImages({ projectDir, runtime: 'docker', services: ['cli-proxy-api', 'runtime'], note: text => notes.push(text) }, {
    run: runtime.run,
    build: async options => {
      builds++;
      assert.deepEqual(options, { projectDir, runtime: 'docker', platform: 'linux/arm64', services: ['cli-proxy-api', 'runtime'], manifest: manifest({}), persist: false });
      return manifest({ 'cli-proxy-api': identity('a', 'linux/arm64'), runtime: identity('b', 'linux/arm64') });
    },
  });
  assert.equal(builds, 1);
  assert.deepEqual(Object.keys(result.images), ['cli-proxy-api', 'runtime']);
  assert.match(notes[0], /Building missing or outdated images/);
  await assert.rejects(readFile(join(projectDir, '.ams/images.json')), { code: 'ENOENT' });
});

test('verified immutable images are reused even when mutable tags are not available', async t => {
  const image = identity();
  const metadata = manifest({ core: image });
  const projectDir = await directory(t, metadata);
  const runtime = engine({ [image.id]: image }, { runtime: 'podman', arch: 'x86_64' });
  const result = await prepareImages({ projectDir, runtime: 'podman', services: ['core'] }, {
    run: runtime.run,
    build: async () => assert.fail('reused images must not be built'),
  });
  assert.deepEqual(result, metadata);
  assert.deepEqual(runtime.calls[1].args, ['image', 'inspect', image.id]);
});

test('only missing selected images build; unrelated entries and existing metadata remain intact', async t => {
  const core = identity('a');
  const panel = identity('b');
  const metadata = manifest({ core, panel, runtime: identity('c') });
  const projectDir = await directory(t, metadata);
  const runtime = engine({ [core.id]: core });
  const original = await readFile(join(projectDir, '.ams/images.json'), 'utf8');
  const result = await prepareImages({ projectDir, runtime: 'docker', services: ['core', 'runtime', 'knowledge'] }, {
    run: runtime.run,
    build: async options => {
      assert.deepEqual(options.services, ['runtime', 'knowledge']);
      assert.equal(options.persist, false);
      assert.deepEqual(options.manifest.images.panel, panel);
      return manifest({ ...options.manifest.images, runtime: identity('d'), knowledge: identity('e') });
    },
  });
  assert.deepEqual(result.images.panel, panel);
  assert.equal(await readFile(join(projectDir, '.ams/images.json'), 'utf8'), original);
});

test('malformed or incompatible saved metadata fails before build', async t => {
  for (const metadata of ['{broken', manifest({ core: { ...identity(), id: 'mutable-tag' } }), manifest({ core: identity('a', 'linux/arm64') })]) {
    const projectDir = await directory(t, metadata);
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker', services: ['core'] }, {
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
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker', services: ['core'] }, { run, build: async () => assert.fail('no build') }), message);
  }
});

test('image identity or platform mismatch fails instead of trusting saved metadata', async t => {
  const image = identity();
  const projectDir = await directory(t, manifest({ core: image }));
  for (const actual of [identity('b'), identity('a', 'linux/arm64')]) {
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker', services: ['core'] }, {
      run: engine({ [image.id]: actual }).run,
      build: async () => assert.fail('mismatched identities must not rebuild silently'),
    }), /Image verification failed for core/);
  }
});

test('engine outage during image inspection does not trigger a build', async t => {
  const projectDir = await directory(t, manifest({ core: identity() }));
  let calls = 0;
  await assert.rejects(prepareImages({ projectDir, runtime: 'docker', services: ['core'] }, {
    run: async () => { if (++calls === 1) return JSON.stringify({ OSType: 'linux', Architecture: 'amd64' }); throw new Error('engine disconnected'); },
    build: async () => assert.fail('no build after engine outage'),
  }), /Cannot read docker engine information/);
});

test('invalid selection and incomplete builder result are rejected', async t => {
  const projectDir = await directory(t);
  for (const services of [[], ['unknown']]) {
    await assert.rejects(prepareImages({ projectDir, runtime: 'docker', services }, { run: async () => assert.fail('no engine access') }), /Invalid required image selection/);
  }
  await assert.rejects(prepareImages({ projectDir, runtime: 'docker', services: ['core'] }, { run: engine().run, build: async () => manifest({}) }), /Missing image: core/);
});

test('old runtime images rebuild despite valid immutable identities; current imported images remain reusable', async t => {
  const core = identity('a'), runtimeImage = identity('b');
  const metadata = manifest({ core, runtime: runtimeImage });
  const projectDir = await directory(t, metadata);
  const original = await readFile(join(projectDir, '.ams/images.json'), 'utf8');
  for (const fingerprint of [null, 'sha256:' + '0'.repeat(64)]) {
    const fake = engine({ [core.id]: core, [runtimeImage.id]: runtimeImage }, { fingerprints: { [runtimeImage.id]: fingerprint } });
    let builds = 0;
    await prepareImages({ projectDir, runtime: 'docker', services: ['core', 'runtime'] }, {
      run: fake.run,
      build: async options => {
        builds++;
        assert.deepEqual(options.services, ['runtime']);
        assert.equal(options.persist, false);
        return manifest({ core, runtime: identity('c') });
      },
    });
    assert.equal(builds, 1);
    assert.equal(await readFile(join(projectDir, '.ams/images.json'), 'utf8'), original);
  }
  const imported = engine({ [core.id]: core, [runtimeImage.id]: runtimeImage }, {
    fingerprints: { [runtimeImage.id]: await buildFingerprint('runtime') },
  });
  assert.deepEqual(await prepareImages({ projectDir, runtime: 'docker', services: ['core', 'runtime'] }, {
    run: imported.run, build: async () => assert.fail('current OCI labels survive export/import; no download or rebuild'),
  }), metadata);
});

test('changing an installation TDAI revision rebuilds its four images while preserving other images', async t => {
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
  await prepareImages({ projectDir, runtime: 'docker', services }, {
    run: fake.run, build: async () => assert.fail('matching installation pin must reuse images'),
  });
  await writePin('b');
  let builds = 0;
  const result = await prepareImages({ projectDir, runtime: 'docker', services }, {
    run: fake.run,
    build: async options => {
      builds++;
      assert.deepEqual(options.services, ['core', 'knowledge', 'panel', 'memory-proxy']);
      assert.equal(options.projectDir, projectDir);
      return options.manifest;
    },
  });
  assert.equal(builds, 1);
  for (const service of ['cli-proxy-api', 'mcp', 'runtime']) assert.deepEqual(result.images[service], images[service]);
});
