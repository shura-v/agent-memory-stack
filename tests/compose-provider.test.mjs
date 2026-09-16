import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeFor } from '../dist/runtime/compose.js';
import { DeploymentError } from '../dist/runtime/errors.js';
import { applyServer, setupServer } from '../dist/setup/server.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';
import { validateEnv } from '../dist/config/settings.js';

const providers = [
  ['docker', 'docker', ['compose', 'version'], /Docker Compose plugin/],
  ['podman', 'podman', ['compose', 'version'], /Compose provider for Podman/],
  ['podman-compose', 'podman-compose', ['version'], /podman-compose.*PATH/],
  ['uvx-podman-compose', 'uvx', ['podman-compose', 'version'], /Install uv/],
];
const manifest = { schemaVersion: 1, images: Object.fromEntries(['runtime', 'cli-proxy-api'].map((name, i) => [name, {
  id: 'sha256:' + String(i + 1).repeat(64), tag: `${name}:test`, platform: 'linux/arm64', repoDigests: [],
}])) };
const settings = validateEnv({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_API_KEY: 'private-service-key' });

test('configured providers are checked with their exact command and reused by preflight', async () => {
  for (const [provider, command, args] of providers) {
    const calls = [];
    const runtime = runtimeFor('/tmp/provider-check', provider, async request => {
      calls.push(request);
      if (request.args[0] === 'info') return JSON.stringify({ host: { arch: 'arm64' } });
      if (request.args[0] === 'image') return JSON.stringify([{ Id: request.args.at(-1), Os: 'linux', Architecture: 'arm64' }]);
      return '';
    });
    await runtime.checkProvider();
    assert.equal(calls[0].command, command);
    assert.deepEqual(calls[0].args, args);
    assert.equal(calls[0].input, undefined);
    await runtime.preflight(manifest, settings);
    assert.equal(calls.filter(call => call.args.at(-1) === 'version').length, 1);
  }
});

test('unavailable providers have actionable diagnostics without raw error output and failures can be retried', async () => {
  for (const [provider, command, args, hint] of providers) {
    let attempts = 0;
    const runtime = runtimeFor('/tmp/provider-check', provider, async () => {
      if (++attempts === 1) throw new Error('upstream output with private-service-key');
      return '';
    });
    await assert.rejects(runtime.checkProvider(), error => {
      assert.ok(error instanceof DeploymentError);
      assert.ok(error.message.includes([command, ...args].join(' ')));
      assert.match(error.message, hint);
      assert.match(error.message, /retry ams apply/);
      assert.doesNotMatch(error.message, /private-service-key|container logs/);
      return true;
    });
    await runtime.checkProvider();
    assert.equal(attempts, 2);
  }
});

test('missing provider stops apply before administrator handoff, image preparation or configuration mutation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-provider-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.ams'));
  const env = encodeEnv(validateEnv({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'core',
    CORE_API_KEY: 'private-core-key', LLM_BASE_URL: 'https://provider.invalid/v1', LLM_API_KEY: 'private-provider-key', MEMORY_LLM_MODEL: 'memory' }));
  await writeFile(join(dir, '.env'), env);
  await writeFile(join(dir, '.ams/runtime.json'), JSON.stringify({ provider: 'podman' }));
  const fail = () => assert.fail('Unavailable provider must stop before prompts or effects');
  const calls = [];
  await assert.rejects(applyServer({ text: fail, select: fail, handoff: fail, note: fail, commit: fail }, dir, {
    prepareImages: fail,
    runtime: (directory, provider) => runtimeFor(directory, provider, async request => {
      calls.push(request);
      throw new Error('private-core-key');
    }),
  }), /Cannot run podman compose version/);
  assert.equal(calls.length, 1);
  assert.equal(await readFile(join(dir, '.env'), 'utf8'), env);
  for (const file of ['compose.yaml', '.ams/images.json', '.ams/before-save.json']) {
    await assert.rejects(readFile(join(dir, file)), { code: 'ENOENT' });
  }
});

test('save-only setup does not require an available Compose provider', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-provider-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, '.env'), encodeEnv(settings));
  const ui = {
    text: async q => q.id === 'directory' ? dir : q.initial,
    select: async (id, _message, choices, initial) => id === 'provider' ? 'podman' : initial ?? choices[0].value,
    confirm: async (id, _message, initial) => id === 'apply' ? false : initial,
    note() {},
  };
  const fail = () => assert.fail('Save-only setup must not invoke provider or image preparation');
  await setupServer(ui, { targets: { recall: async () => undefined, remember: async () => {} }, runtime: fail, prepareImages: fail });
  assert.equal((await readEnv(join(dir, '.env'))).AMS_SERVICES, 'cli-proxy-api');
  assert.equal(JSON.parse(await readFile(join(dir, '.ams/runtime.json'), 'utf8')).provider, 'podman');
});
