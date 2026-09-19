import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpGateway } from '../dist/runtime/mcp-gateway.js';

const stockServer = new URL('./fixtures/mcp-stdio.mjs', import.meta.url).pathname;
const init = { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const tool = (args = {}, id = 7) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'transport_probe', arguments: args } });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for child lifecycle');
};
async function fixture(t, { coreApiKey = 'core-secret' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-mcp-'));
  const control = join(directory, 'control.json');
  const calls = [], clients = [];
  const state = { inactive: false, revoked: false, unavailable: false, failInitialization: false, holdInitialization: false };
  let saveSequence = 0;
  const save = async () => {
    const temporary = control + '.' + ++saveSequence;
    await writeFile(temporary, JSON.stringify(state)); await rename(temporary, control);
  };
  const started = async () => (await readFile(control + '.started', 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(Number);
  const called = async () => (await readFile(control + '.called', 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(Number);
  const reaped = () => waitFor(async () => (await started()).every(pid => !alive(pid)));
  await save();
  const fetcher = async (url, request) => {
    const endpoint = new URL(url); calls.push(endpoint.pathname);
    assert.equal(request.headers.authorization, coreApiKey ? `Bearer ${coreApiKey}` : undefined);
    if (state.unavailable) throw new Error('secret credentials');
    const data = JSON.parse(request.body);
    if (endpoint.pathname.endsWith('/auth/verify')) return Response.json({ code: 0, data: { valid: !state.revoked && ['alice', 'bob', 'alice-new'].includes(data.user_key), user: { user_id: data.user_key.startsWith('alice') ? 'alice' : 'bob' } } });
    return Response.json({ code: 0, data: { total: state.inactive ? 0 : 1, items: state.inactive ? [] : [{ user_id: data.user_ids[0], status: 'active' }] } });
  };
  const server = createMcpGateway({ port: 8425, coreUrl: 'http://core', coreApiKey, knowledgeToolsUrl: pathToFileURL(control).href, serviceId: 'ams' }, { stockServer, fetcher });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await reaped();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (options = {}) => fetch(url + (options.path ?? '/mcp'), {
    method: options.method ?? 'POST', headers: { authorization: `Bearer ${options.key ?? 'alice'}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(10_000),
    ...(['GET', 'DELETE'].includes(options.method) ? {} : { body: options.raw ?? JSON.stringify(options.body ?? init) }),
  });
  const probe = async ({ key, id = 7, ...args } = {}) => {
    const response = await request({ key, body: tool(args, id) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    const message = await response.json();
    assert.equal(message.id, id); return JSON.parse(message.result.content[0].text);
  };
  const connect = async key => {
    const client = new Client({ name: 'http-fixture', version: '1' }); clients.push(client);
    const transport = new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
    await client.connect(transport);
    assert.equal(transport.sessionId, undefined);
    return client;
  };
  return { url, request, probe, connect, state, save, calls, started, called, reaped, server, control };
}

test('SDK HTTP client uses native tools with a fresh stdio process per request and no sessions', async t => {
  const f = await fixture(t); const client = await f.connect('alice');
  assert.deepEqual(client.getServerVersion(), { name: 'transport-fixture', version: '1' });
  assert.deepEqual(client.getServerCapabilities(), { tools: {} });
  assert.equal(client.getInstructions(), 'Fixture instructions');
  assert.equal((await client.listTools()).tools[0].name, 'transport_probe');
  const first = JSON.parse((await client.callTool({ name: 'transport_probe', arguments: { value: 'one' } })).content[0].text);
  await waitFor(() => !alive(first.pid));
  const second = JSON.parse((await client.callTool({ name: 'transport_probe', arguments: { value: 'two' } })).content[0].text);
  assert.notEqual(first.pid, second.pid);
  assert.deepEqual([first.value, second.value], ['one', 'two']);
  await f.reaped();
  const pids = await f.started();
  assert.equal(new Set(pids).size, pids.length);
});

test('concurrent same and different credentials with identical IDs own independent children', async t => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.probe({ id: 11, value: 'first', delay: 100 }),
    f.probe({ id: 11, value: 'second' }),
    f.probe({ id: 11, key: 'bob', value: 'third' }),
  ]);
  assert.deepEqual(results.map(item => item.value), ['first', 'second', 'third']);
  assert.equal(new Set(results.map(item => item.pid)).size, 3);
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.deepEqual(results.map(item => item.tokenHash), [hash('alice'), hash('alice'), hash('bob')]);
  assert.ok(results.every(item => !item.resources.includes('TCPServerWrap')));
  await f.reaped();
});

test('the 65th concurrent request replaces the oldest child and completed requests release capacity', async t => {
  const f = await fixture(t);
  const controllers = Array.from({ length: 64 }, () => new AbortController());
  const start = (controller, index) => f.request({
    body: tool({ value: `held-${index}`, delay: 60_000 }, index + 1), signal: controller.signal,
  }).then(response => ({ response }), error => ({ error }));
  const first = start(controllers[0], 0);
  await waitFor(async () => (await f.called()).length === 1);
  const hanging = [first, ...controllers.slice(1).map((controller, index) => start(controller, index + 1))];
  await waitFor(async () => (await f.called()).length === 64);
  const original = await f.started();
  assert.equal(original.length, 64);

  const replacement = await f.probe({ id: 65, value: 'replacement' });
  const evicted = await hanging[0];
  assert.equal(evicted.response?.status, 503);
  assert.equal((await evicted.response.json()).error.message, 'MCP capacity reclaimed');
  assert.equal(alive(original[0]), false);
  assert.ok(original.slice(1).every(alive));
  assert.ok(!original.includes(replacement.pid));

  await waitFor(() => !alive(replacement.pid));
  await new Promise(resolve => setImmediate(resolve));
  const afterCompletion = await f.probe({ id: 66, value: 'after-completion' });
  assert.equal(afterCompletion.value, 'after-completion');
  assert.ok(original.slice(1).every(alive), 'the completed replacement released its slot');
  controllers.slice(1).forEach(controller => controller.abort());
  await Promise.all(hanging.slice(1));
  await f.reaped();
});

test('a request aborted while waiting for capacity never starts a child', async t => {
  const f = await fixture(t);
  const controllers = Array.from({ length: 64 }, () => new AbortController());
  const start = (controller, index) => f.request({
    body: tool({ delay: 60_000 }, index + 1), signal: controller.signal,
  }).then(response => ({ response }), error => ({ error }));
  const first = start(controllers[0], 0);
  await waitFor(async () => (await f.called()).length === 1);
  const hanging = [first, ...controllers.slice(1).map((controller, index) => start(controller, index + 1))];
  await waitFor(async () => (await f.called()).length === 64);
  const original = await f.started();

  const waitingController = new AbortController();
  const waiting = f.request({ body: tool({}, 65), signal: waitingController.signal })
    .then(response => ({ response }), error => ({ error }));
  assert.equal((await hanging[0]).response?.status, 503);
  waitingController.abort();
  assert.match(String((await waiting).error), /abort/i);
  await waitFor(() => !alive(original[0]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.started()).length, 64);
  assert.ok(original.slice(1).every(alive));

  controllers.slice(1).forEach(controller => controller.abort());
  await Promise.all(hanging.slice(1));
  await f.reaped();
});

test('every POST revalidates current user credentials and status before spawning', async t => {
  const f = await fixture(t); await f.probe();
  const count = (await f.started()).length;
  f.state.revoked = true;
  assert.equal((await f.request({ body: tool() })).status, 401);
  f.state.revoked = false; f.state.inactive = true;
  assert.equal((await f.request({ body: tool() })).status, 403);
  assert.equal((await f.started()).length, count);
});

test('MCP starts without a Core service key and still rejects invalid user keys', async t => {
  const f = await fixture(t, { coreApiKey: '' }); await f.probe();
  assert.equal((await f.request({ key: 'invalid' })).status, 401);
  assert.equal((await f.started()).length, 1);
});

test('MCP fails closed on auth outage without leaking errors or starting a child', async t => {
  const f = await fixture(t); f.state.unavailable = true;
  const response = await f.request(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|credentials/);
  assert.deepEqual(await f.started(), []);
});

test('GET and DELETE report unsupported methods without creating children', async t => {
  const f = await fixture(t);
  for (const method of ['GET', 'DELETE']) {
    const response = await f.request({ method });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST');
    assert.equal((await response.json()).error.message, 'Method not allowed');
  }
  assert.deepEqual(await f.started(), []);
});

test('invalid payloads, routes, headers and origins fail before authorization', async t => {
  const f = await fixture(t);
  for (const [options, status] of [[{ raw: '[' }, 400], [{ raw: 'x'.repeat(110_000) }, 413], [{ body: [] }, 400],
    [{ path: '/v3/tools/call' }, 404], [{ path: '/mcp?key=alice' }, 404], [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { 'x-tdai-service-id': 'other' } }, 403], [{ headers: { authorization: '' } }, 401],
    [{ headers: { 'content-type': 'application/json; charset=iso-8859-1' } }, 415],
    [{ headers: { accept: 'application/json' } }, 406], [{ headers: { 'content-encoding': 'gzip' } }, 415],
    [{ headers: { 'mcp-protocol-version': 'invalid' } }, 400]]) assert.equal((await f.request(options)).status, status);
  assert.equal(f.calls.length, 0); assert.deepEqual(await f.started(), []);
  assert.equal((await fetch(f.url + '/health')).status, 200);
  const valid = await f.request({ headers: { origin: f.url.replace('http:', 'https:') } });
  assert.equal(valid.status, 200, 'Caddy TLS origin with preserved Host accepted'); await valid.text();
});

test('duplicate authentication headers fail before Core and child startup', async t => {
  const f = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.url + '/mcp', { method: 'POST', headers: ['Authorization', 'Bearer alice', 'Authorization', 'Bearer bob', 'Content-Type', 'application/json'] }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify(init));
  });
  assert.equal(status, 400); assert.equal(f.calls.length, 0); assert.deepEqual(await f.started(), []);
});

test('initialization validates request IDs before authorization and child startup', async t => {
  const f = await fixture(t);
  for (const id of [1.5, null]) assert.equal((await f.request({ body: { ...init, id } })).status, 400);
  assert.deepEqual(await f.started(), []); assert.equal(f.calls.length, 0);
});

test('SDK rejects unsupported protocol versions without retaining a process', async t => {
  const f = await fixture(t);
  const response = await f.request({ body: tool(), headers: { 'mcp-protocol-version': '2099-01-01' } });
  assert.equal(response.status, 400); assert.match(await response.text(), /Unsupported protocol version/);
  await f.reaped(); assert.equal((await f.probe({ value: 'next' })).value, 'next');
});

test('native tool results and protocol error code/data survive the SDK bridge', async t => {
  const f = await fixture(t); const client = await f.connect('alice');
  assert.deepEqual(await client.callTool({ name: 'transport_probe', arguments: { toolError: true } }), { isError: true, content: [{ type: 'text', text: 'Fixture tool failure' }] });
  await assert.rejects(client.callTool({ name: 'transport_probe', arguments: { protocolError: true } }), error => error.code === -32602 && error.data.field === 'value' && /Fixture request rejected/.test(error.message));
  await f.reaped();
});

test('failed native initialization returns its error and releases its child', async t => {
  const f = await fixture(t); f.state.failInitialization = true; await f.save();
  const response = await f.request(); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.id, 1); assert.equal(result.error.code, -32600); assert.match(result.error.message, /Fixture initialization rejected/);
  await f.reaped();
  f.state.failInitialization = false; await f.save();
  assert.equal((await f.probe({ value: 'recovered' })).value, 'recovered');
});

test('one child crash does not affect another concurrent request', async t => {
  const f = await fixture(t);
  const [failed, successful] = await Promise.all([f.request({ body: tool({ crash: true }) }), f.probe({ value: 'survived', delay: 80 })]);
  assert.equal((await failed.json()).error.code, -32000);
  assert.equal(successful.value, 'survived'); await f.reaped();
});

for (const phase of ['initialization', 'tool']) test(`client abort closes its child during ${phase}`, async t => {
  const f = await fixture(t); f.state.holdInitialization = phase === 'initialization'; await f.save();
  const abort = new AbortController();
  const pending = f.request({ body: phase === 'initialization' ? init : tool({ delay: 60_000 }), signal: abort.signal });
  const rejected = assert.rejects(pending, /abort/i);
  await waitFor(async () => (await f.started()).length === 1);
  if (phase === 'tool') await waitFor(async () => (await f.called()).length === 1);
  abort.abort(); await rejected; await f.reaped();
});

test('gateway shutdown drains hanging stdio children and exits naturally', async t => {
  const f = await fixture(t); f.state.holdInitialization = true; await f.save();
  const source = `
    import { createMcpGateway } from ${JSON.stringify(new URL('../dist/runtime/mcp-gateway.js', import.meta.url).href)};
    const server = createMcpGateway(${JSON.stringify({ port: 8425, coreUrl: 'http://core', coreApiKey: '', knowledgeToolsUrl: pathToFileURL(f.control).href, serviceId: 'ams' })}, {
      stockServer: ${JSON.stringify(stockServer)},
      fetcher: async url => Response.json({ code: 0, data: String(url).endsWith('/auth/verify') ? { valid: true, user: { user_id: 'alice' } } : { total: 1, items: [{ user_id: 'alice', status: 'active' }] } })
    });
    server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
    process.once('SIGTERM', () => { server.close(); server.closeAllConnections(); });
  `;
  const gateway = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (gateway.exitCode === null) gateway.kill('SIGKILL'); });
  const [port] = await once(gateway.stdout, 'data');
  const pending = fetch(`http://127.0.0.1:${String(port).trim()}/mcp`, { method: 'POST', headers: { authorization: 'Bearer alice', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(init), signal: AbortSignal.timeout(10_000) });
  const rejected = assert.rejects(pending);
  await waitFor(async () => (await f.started()).length === 1);
  const exited = once(gateway, 'exit'); gateway.kill('SIGTERM');
  await rejected;
  const [code, signal] = await exited;
  assert.equal(code, 0); assert.equal(signal, null); await f.reaped();
});
