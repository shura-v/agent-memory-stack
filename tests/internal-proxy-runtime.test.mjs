import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { runtimeFor } from '../dist/runtime/compose.js';
import { InternalModelAccessError } from '../dist/runtime/model-discovery.js';
import { generate } from '../dist/runtime/config.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';
import { validateEnv } from '../dist/config/settings.js';
import { imageServices } from '../dist/build/images.js';
import { runProcess } from '../dist/runtime/process.js';

const manifest = { schemaVersion: 1, images: Object.fromEntries(imageServices.map((service, i) => [service, {
  id: 'sha256:' + String(i + 1).repeat(64), tag: `${service}:test`, platform: 'linux/arm64', repoDigests: [],
}])) };
async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-internal-proxy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = validateEnv({ INTERNAL_LLM_SOURCE: 'cliproxy', CORE_API_KEY: 'private-core-key',
    CLIPROXY_API_KEY: 'private-proxy-key', ...extra }, { allowPendingModels: true });
  await mkdir(join(directory, '.ams'));
  await mkdir(join(directory, 'generated'));
  await writeFile(join(directory, '.env'), encodeEnv(settings));
  await writeFile(join(directory, '.ams/images.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'compose.yaml'), 'previous complete compose');
  await writeFile(join(directory, 'generated/core-env.json'), 'previous core configuration');
  const calls = [];
  const run = async request => {
    calls.push(request);
    const args = request.args;
    if (args[0] === 'ps') return args.find(arg => arg.startsWith('label=com.docker.compose.service='))?.split('=').at(-1) ?? '';
    if (args[0] === 'inspect') return JSON.stringify([{ State: args.at(-1) === 'bootstrap'
      ? { Status: 'exited', ExitCode: 0 } : { Status: 'running', Health: { Status: 'healthy' } } }]);
    if (args.includes('/app/runtime/provider-auth.js')) return 'true';
    if (args.includes('/app/runtime/integration.js')) return '{"pending":[]}';
    return '';
  };
  return { directory, settings, calls, run, project: `ams-${createHash('sha256').update(directory).digest('hex').slice(0, 10)}` };
}

test('pending local setup prepares only the proxy without touching full configuration or consumer data', async t => {
  const { directory, settings, calls, run, project } = await fixture(t);
  const runtime = runtimeFor(directory, 'podman-compose', run);
  await runtime.prepareInternalProxy(manifest, settings);
  const stage = join(directory, '.ams/internal-proxy');
  const compose = parse(await readFile(join(stage, 'compose.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(compose.services), ['config', 'cli-proxy-api']);
  assert.equal(compose.services['cli-proxy-api'].ports, undefined);
  assert.equal((await readEnv(join(stage, '.env'))).DATA_DIR, join(directory, 'data'));
  assert.equal(await readFile(join(directory, 'compose.yaml'), 'utf8'), 'previous complete compose');
  assert.equal(await readFile(join(directory, 'generated/core-env.json'), 'utf8'), 'previous core configuration');
  assert.ok(calls.filter(c => c.command === 'podman-compose' && !c.args.includes('version')).every(c => c.args.includes(project) && c.args.includes(join(stage, 'compose.yaml'))));
  assert.deepEqual(calls.filter(c => c.args.includes('up')).map(c => c.args.at(-1)), ['cli-proxy-api']);
  await generate(stage);
  assert.deepEqual(await readdir(join(stage, 'generated')), ['cli-proxy-api.yaml']);
  assert.deepEqual(await readdir(join(directory, 'data')), ['cli-proxy-api']);
  assert.equal(await runtime.hasProviderAuthorization('codex'), true);
  await runtime.login('claude');
  const login = calls.find(c => c.args.includes('-claude-login'));
  assert.ok(login.args.includes(join(stage, 'compose.yaml')));
  assert.equal(login.interactive, true);
  assert.ok(login.args.includes('-no-browser'));
  assert.ok(!login.args.includes('--service-ports'));
  const loginIndex = calls.indexOf(login);
  assert.ok(calls[loginIndex - 1].args.includes('stop'));
  assert.ok(calls[loginIndex + 1].args.includes('up'));
});

test('preparation preserves an explicitly enabled CLIProxyAPI loopback interface', async t => {
  const { directory, settings, run } = await fixture(t, { CLIPROXY_SERVICE_ENABLED: 'true', CLIPROXY_SERVICE_PORT: '18317' });
  await runtimeFor(directory, 'docker', run).prepareInternalProxy(manifest, settings);
  const compose = parse(await readFile(join(directory, '.ams/internal-proxy/compose.yaml'), 'utf8'));
  assert.deepEqual(compose.services['cli-proxy-api'].ports, ['127.0.0.1:18317:8317']);
});

test('local discovery uses the Compose network, stdin credentials, and a five-second limit', async t => {
  const { directory, settings, project } = await fixture(t);
  let request;
  const runtime = runtimeFor(directory, 'podman-compose', async value => {
    request = value; return JSON.stringify({ models: ['gpt-model', 'claude-model', 'gpt-model', 'bad\nmodel', ''] });
  });
  assert.deepEqual(await runtime.discoverInternalModels(manifest, settings), ['gpt-model', 'claude-model']);
  assert.equal(request.args[request.args.indexOf('--network') + 1], `${project}_stack`);
  assert.deepEqual(JSON.parse(request.input), { baseUrl: 'http://cli-proxy-api:8317/v1', apiKey: settings.CLIPROXY_API_KEY });
  assert.equal(request.timeoutMs, 5000);
  assert.ok(!JSON.stringify(request.args).includes(settings.CLIPROXY_API_KEY));
  assert.ok(!request.args.some(arg => ['--publish', '-p', '--service-ports'].includes(arg)));
});

test('discovery keeps local access rejection distinct from unavailable or empty models', async t => {
  const { directory, settings } = await fixture(t);
  for (const status of [401, 403]) {
    const runtime = runtimeFor(directory, 'docker', async () => JSON.stringify({ status, models: [] }));
    await assert.rejects(runtime.discoverInternalModels(manifest, settings), error => error instanceof InternalModelAccessError
      && error.status === status && /CLIProxyAPI/.test(error.message) && !error.message.includes(settings.CLIPROXY_API_KEY));
  }
  for (const output of ['', 'null', '{}', '{"models":[]}']) {
    assert.deepEqual(await runtimeFor(directory, 'docker', async () => output).discoverInternalModels(manifest, settings), []);
  }
  assert.deepEqual(await runtimeFor(directory, 'docker', async () => { throw new Error('timeout'); }).discoverInternalModels(manifest, settings), []);
});

test('runtime discovery entrypoint reads credentials from stdin and returns sanitized models or access status', async t => {
  let status = 200;
  const server = createServer((request, response) => {
    assert.equal(request.url, '/v1/models');
    assert.equal(request.headers.authorization, 'Bearer private-entrypoint-key');
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(status === 200 ? JSON.stringify({ data: [{ id: 'memory-model' }] }) : 'private server diagnostic');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = {
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/runtime/model-discovery.js', import.meta.url)), '--stdin'],
    input: JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'private-entrypoint-key' }),
  };
  assert.deepEqual(JSON.parse(await runProcess(request)), { models: ['memory-model'] });
  status = 401;
  assert.deepEqual(JSON.parse(await runProcess(request)), { models: [], status: 401 });
});

test('full apply starts the shared proxy before Core and returns login to the full Compose file', async t => {
  const { directory, settings, calls, run } = await fixture(t, { MEMORY_LLM_MODEL: 'memory', KNOWLEDGE_LLM_MODEL: 'knowledge' });
  const runtime = runtimeFor(directory, 'podman-compose', run);
  await runtime.prepareInternalProxy(manifest, settings);
  calls.length = 0;
  await runtime.apply('private-admin-key');
  const startups = calls.filter(c => c.args.includes('up'));
  assert.equal(startups[0].args.at(-1), 'cli-proxy-api');
  assert.equal(startups[1].args.at(-1), 'core');
  assert.ok(startups.every(c => c.args.includes(join(directory, 'compose.yaml'))));
  calls.length = 0;
  await runtime.login('codex');
  assert.ok(calls.find(c => c.args.includes('-codex-device-login')).args.includes(join(directory, 'compose.yaml')));
});
