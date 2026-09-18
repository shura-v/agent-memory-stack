import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMcpGateway } from '../dist/runtime/mcp-gateway.js';
import { McpWorkers, supergatewayFactory } from '../dist/runtime/mcp-workers.js';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, { realWorkers = false } = {}) {
  const calls = [], launches = [], upstreamCalls = [], createdWorkers = [];
  const state = { inactive: false, revoked: false, mismatched: false, unavailable: false, streaming: false, streamClosed: false, failInitialization: false };
  let sequence = 0;
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    upstreamCalls.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (state.errorResponse) { res.writeHead(400, { 'content-type': state.errorContentType ?? 'application/json' }); res.end(typeof state.errorResponse === 'string' ? state.errorResponse : JSON.stringify(state.errorResponse)); return; }
    if (state.failInitialization) { res.writeHead(400); res.end('Rejected'); return; }
    if (state.holdInitialization) await state.holdInitialization;
    const session = req.headers['mcp-session-id'] || `session-${++sequence}`;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': session });
    const event = 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
    if (state.streaming) { res.write(event); res.once('close', () => { state.streamClosed = true; }); } else res.end(event);
  });
  const upstream = await listen(backend);
  const workers = new McpWorkers(realWorkers ? supergatewayFactory(upstream, 'ams') : async key => {
    launches.push(key); let alive = true;
    const worker = { url: upstream + '/mcp', sessions: new Map(), pending: 0, alive: () => alive, stop: async () => { alive = false; } };
    createdWorkers.push(worker); return worker;
  });
  const fetcher = async (url, init) => {
    const endpoint = new URL(url); calls.push(endpoint.pathname);
    if (state.unavailable) throw new Error('secret credentials');
    if (endpoint.pathname === '/ams/identity') return Response.json({ coreId: state.mismatched && endpoint.hostname === 'tools' ? 'other' : 'core-one', ...(endpoint.hostname === 'tools' ? { knowledgeId: 'knowledge-one' } : {}) });
    const data = JSON.parse(init.body);
    if (endpoint.pathname.endsWith('/auth/verify')) return Response.json({ code: 0, data: { valid: !state.revoked && ['alice', 'bob', 'alice-new'].includes(data.user_key), user: { user_id: data.user_key.startsWith('alice') ? 'alice' : 'bob' } } });
    return Response.json({ code: 0, data: { total: state.inactive ? 0 : 1, items: state.inactive ? [] : [{ user_id: data.user_ids[0], status: 'active' }] } });
  };
  const server = createMcpGateway({ port: 8425, coreUrl: 'http://core', coreApiKey: 'core-secret', knowledgeToolsUrl: 'http://tools', serviceId: 'ams' }, { workers, fetcher });
  const url = await listen(server);
  t.after(async () => { server.closeAllConnections(); backend.closeAllConnections(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => backend.close(resolve)), workers.close()]); });
  const request = (options = {}) => fetch(url + (options.path ?? '/mcp'), {
    method: options.method ?? 'POST', headers: { authorization: `Bearer ${options.key ?? 'alice'}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(options.session ? { 'mcp-session-id': options.session } : {}), ...options.headers },
    signal: AbortSignal.timeout(10_000),
    ...(['GET', 'DELETE'].includes(options.method) ? {} : { body: options.raw ?? JSON.stringify(options.body ?? { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) }),
  });
  return { url, request, state, calls, launches, upstreamCalls, createdWorkers };
}

test('MCP forwards complete stream and binds sessions to both user and credential', async t => {
  const f = await fixture(t);
  const first = await f.request(); assert.equal(first.status, 200); assert.match(await first.text(), /^data:/);
  const session = first.headers.get('mcp-session-id'); assert.ok(session);
  assert.equal(f.upstreamCalls[0].headers.authorization, undefined);
  assert.equal(f.upstreamCalls[0].headers['x-tdai-user-id'], undefined);
  for (const key of ['bob', 'alice-new']) assert.equal((await f.request({ method: 'GET', session, key })).status, 404);
  assert.equal(f.upstreamCalls.length, 1);
  assert.equal((await f.request({ method: 'GET', session })).status, 200);
  assert.equal((await f.request({ method: 'DELETE', session })).status, 200);
  assert.equal((await f.request({ method: 'GET', session })).status, 404);
});

test('MCP revalidates current user status and credential on every lifecycle request', async t => {
  const f = await fixture(t); const first = await f.request(); const session = first.headers.get('mcp-session-id'); await first.text();
  f.state.revoked = true;
  for (const method of ['GET', 'DELETE', 'POST']) assert.equal((await f.request({ method, session, body: { jsonrpc: '2.0', method: 'tools/list', id: 2 } })).status, 401);
  f.state.revoked = false; f.state.inactive = true;
  assert.equal((await f.request({ method: 'GET', session })).status, 403);
  assert.equal(f.upstreamCalls.length, 1);
});

test('MCP fails closed on mismatched dependencies and auth outage without leaking errors', async t => {
  const f = await fixture(t); f.state.mismatched = true;
  assert.equal((await f.request()).status, 503); assert.equal(f.launches.length, 0);
  f.state.mismatched = false; f.state.unavailable = true;
  const response = await f.request(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|credentials/);
});

test('MCP rejects invalid payload, raw routes and untrusted browser origins before authorization', async t => {
  const f = await fixture(t);
  for (const [options, status] of [[{ raw: '[' }, 400], [{ raw: 'x'.repeat(110_000) }, 413], [{ body: [] }, 400],
    [{ path: '/v3/tools/call' }, 404], [{ path: '/mcp?key=alice' }, 404], [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { 'x-tdai-service-id': 'other' } }, 403], [{ headers: { authorization: '' } }, 401],
    [{ method: 'GET' }, 400], [{ headers: { 'mcp-session-id': 'unsafe,session' } }, 400]]) {
    assert.equal((await f.request(options)).status, status);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await fetch(f.url + '/health')).status, 200);
  assert.equal((await f.request({ headers: { origin: f.url.replace('http:', 'https:') } })).status, 200, 'Caddy TLS origin with preserved Host accepted');
});

test('duplicate authentication headers are rejected before contacting Core', async t => {
  const f = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.url + '/mcp', { method: 'POST', headers: ['Authorization', 'Bearer alice', 'Authorization', 'Bearer bob', 'Content-Type', 'application/json'] }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end('{"jsonrpc":"2.0","method":"initialize","id":1}');
  });
  assert.equal(status, 400); assert.equal(f.calls.length, 0);
});

test('worker pool bounds concurrent creation, reuses credentials and expires idle children', async () => {
  let starts = 0, stops = 0;
  const pool = new McpWorkers(async () => { starts++; return { url: 'http://localhost', sessions: new Map(), pending: 0, alive: () => true, stop: async () => { stops++; } }; }, 1, 1);
  try {
    const [one, same] = await Promise.all([pool.acquire('alice-context', 'alice'), pool.acquire('alice-context', 'alice')]);
    assert.equal(starts, 1); assert.equal(one.worker, same.worker);
    await assert.rejects(pool.acquire('bob-context', 'bob'), /capacity/);
    await new Promise(resolve => setTimeout(resolve, 5)); await pool.expire(); assert.equal(stops, 0);
    one.release(); same.release(); await new Promise(resolve => setTimeout(resolve, 5)); await pool.expire(); assert.equal(stops, 1);
  } finally { await pool.close(); }
  await assert.rejects(pool.acquire('alice-context', 'alice'), /stopping/);
});


test('discard frees worker capacity immediately while process shutdown is still pending', async t => {
  let finishStop;
  const stopping = new Promise(resolve => { finishStop = resolve; });
  let starts = 0;
  const pool = new McpWorkers(async () => {
    const first = starts++ === 0;
    let alive = true;
    return { url: 'http://localhost', sessions: new Map(), pending: 0, alive: () => alive,
      stop: async () => { alive = false; if (first) await stopping; } };
  }, 1);
  t.after(async () => { finishStop(); await pool.close(); });
  const failed = await pool.acquire('alice-context', 'alice');
  const discarded = failed.discard();
  const replacement = await pool.acquire('bob-context', 'bob');
  assert.equal(starts, 2, 'the stopped entry cannot occupy the only pool slot');
  assert.equal(failed.worker.alive(), false);
  assert.equal(replacement.worker.alive(), true);
  failed.release(); replacement.release();
  finishStop(); await discarded;
});

test('a stale lease cannot discard a replacement worker for the same credential', async t => {
  let starts = 0;
  const pool = new McpWorkers(async () => {
    starts++; let alive = true;
    return { url: 'http://localhost', sessions: new Map(), pending: 0, alive: () => alive,
      stop: async () => { alive = false; } };
  }, 1);
  t.after(() => pool.close());
  const original = await pool.acquire('alice-context', 'alice');
  const stale = await pool.acquire('alice-context', 'alice');
  await original.discard();
  const replacement = await pool.acquire('alice-context', 'alice');
  await stale.discard();
  original.release(); stale.release();
  const same = await pool.acquire('alice-context', 'alice');
  assert.equal(same.worker, replacement.worker);
  assert.equal(replacement.worker.alive(), true);
  assert.equal(starts, 2, 'stale cleanup leaves the replacement registered');
  same.release(); replacement.release();
});

test('session capacity is bounded and expired session slots are reusable', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 8; index++) { const response = await f.request(); assert.equal(response.status, 200); await response.text(); }
  assert.equal((await f.request()).status, 429);
  for (const session of f.createdWorkers[0].sessions.values()) session.touched = Date.now() - 300_001;
  assert.equal((await f.request()).status, 200);
  assert.equal(f.createdWorkers[0].sessions.size, 1);
});

test('failed initialization reaps the worker and unregistered adapter', async t => {
  const f = await fixture(t); f.state.failInitialization = true;
  const response = await f.request(); assert.equal(response.status, 400); await response.text();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.createdWorkers[0].alive(), false);
});

test('failed initialization preserves established sessions sharing the worker', async t => {
  const f = await fixture(t);
  const first = await f.request(); const session = first.headers.get('mcp-session-id'); await first.text();
  f.state.failInitialization = true;
  const failed = await f.request(); assert.equal(failed.status, 400); await failed.text();
  f.state.failInitialization = false;
  const next = await f.request({ session, body: { jsonrpc: '2.0', method: 'tools/list', id: 2 } });
  assert.equal(next.status, 200); await next.text();
  assert.equal(f.createdWorkers[0].alive(), true);
  assert.equal(f.launches.length, 1);
});

test('failed initialization preserves another initialization still in progress', async t => {
  const f = await fixture(t);
  let finish;
  f.state.holdInitialization = new Promise(resolve => { finish = resolve; });
  t.after(() => finish());
  const pending = f.request();
  for (let attempt = 0; attempt < 100 && f.upstreamCalls.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.upstreamCalls.length, 1);
  f.state.failInitialization = true;
  const failed = await f.request(); assert.equal(failed.status, 400); await failed.text();
  assert.equal(f.createdWorkers[0].alive(), true);
  f.state.failInitialization = false; finish();
  const first = await pending; assert.equal(first.status, 200); await first.text();
  const next = await f.request({ method: 'GET', session: first.headers.get('mcp-session-id') });
  assert.equal(next.status, 200); await next.text();
});

test('real Supergateway keeps a session usable after another initialization returns 415', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { realWorkers: true });
  const first = await f.request(); assert.equal(first.status, 200); await first.text();
  const session = first.headers.get('mcp-session-id'); assert.ok(session);
  const ready = await f.request({ session, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(ready.status, 202); await ready.text();
  const failed = await f.request({ headers: { 'content-type': 'application/json; charset=iso-8859-1' } });
  assert.equal(failed.status, 415); await failed.text();
  const next = await f.request({ session, body: { jsonrpc: '2.0', method: 'tools/list', id: 2 } });
  assert.equal(next.status, 200); assert.match(await next.text(), /list_knowledge_tools/);
  const deleted = await f.request({ method: 'DELETE', session });
  assert.equal(deleted.status, 200); await deleted.text();
});

test('real Supergateway accepts the corrected initialization immediately after an initial 415', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { realWorkers: true });
  const failed = await f.request({ headers: { 'content-type': 'application/json; charset=iso-8859-1' } });
  assert.equal(failed.status, 415); await failed.text();
  // The very next request must create a fresh worker, without a sacrificial 503 or retry.
  const corrected = await f.request();
  assert.equal(corrected.status, 200); await corrected.text();
  const session = corrected.headers.get('mcp-session-id'); assert.ok(session);
  const ready = await f.request({ session, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(ready.status, 202); await ready.text();
  const tools = await f.request({ session, body: { jsonrpc: '2.0', method: 'tools/list', id: 2 } });
  assert.equal(tools.status, 200); assert.match(await tools.text(), /list_knowledge_tools/);
});

for (const method of ['POST', 'GET', 'DELETE']) test(`real Supergateway lost session returns 404 for ${method} and permits a fresh initialization`, { timeout: 20_000 }, async t => {
  const f = await fixture(t, { realWorkers: true });
  const first = await f.request(); assert.equal(first.status, 200); await first.text();
  const session = first.headers.get('mcp-session-id'); assert.ok(session);
  const ready = await f.request({ session, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(ready.status, 202); await ready.text();
  const unsupported = await f.request({ session, headers: { 'mcp-protocol-version': '2099-01-01' },
    body: { jsonrpc: '2.0', method: 'tools/list', id: 2 } });
  assert.equal(unsupported.status, 400); assert.match(await unsupported.text(), /Unsupported protocol version/);
  const lost = await f.request({ method, session, headers: { 'mcp-protocol-version': '2025-03-26' },
    body: { jsonrpc: '2.0', method: 'tools/list', id: 3 } });
  assert.equal(lost.status, 404, 'missing upstream session maps to the MCP reinitialization status'); await lost.text();
  const forgotten = await f.request({ session, body: { jsonrpc: '2.0', method: 'tools/list', id: 4 } });
  assert.equal(forgotten.status, 404);
  assert.equal((await forgotten.json()).error.message, 'Session unavailable', 'the stale session is rejected by the gateway locally');
  const fresh = await f.request(); assert.equal(fresh.status, 200); await fresh.text();
  const freshSession = fresh.headers.get('mcp-session-id'); assert.ok(freshSession); assert.notEqual(freshSession, session);
  const initialized = await f.request({ session: freshSession, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(initialized.status, 202); await initialized.text();
  const tools = await f.request({ session: freshSession, body: { jsonrpc: '2.0', method: 'tools/list', id: 5 } });
  assert.equal(tools.status, 200); assert.match(await tools.text(), /list_knowledge_tools/);
});

for (const method of ['POST', 'GET', 'DELETE']) test(`${method} ordinary, non-JSON and oversized upstream 400 responses preserve their bytes and session`, async t => {
  const f = await fixture(t);
  const first = await f.request(); assert.equal(first.status, 200); await first.text();
  const session = first.headers.get('mcp-session-id'); assert.ok(session);
  for (const [contentType, body] of [
    ['application/json', { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Bad Request: Invalid tool parameters' } }],
    ['text/plain', 'ordinary non-JSON upstream rejection'],
    ...(method === 'POST' ? [['text/plain', 'Invalid or missing session ID']] : []),
    ['application/json', { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, padding: 'x'.repeat(65_536) }],
  ]) {
    f.state.errorContentType = contentType;
    f.state.errorResponse = body;
    const invalid = await f.request({ method, session, body: { jsonrpc: '2.0', method: 'tools/list', id: 2 } });
    assert.equal(invalid.status, 400);
    assert.equal(await invalid.text(), typeof body === 'string' ? body : JSON.stringify(body));
    assert.equal(f.createdWorkers[0].sessions.has(session), true);
    f.state.errorResponse = undefined;
    const corrected = await f.request({ session, body: { jsonrpc: '2.0', method: 'tools/list', id: 3 } });
    assert.equal(corrected.status, 200); await corrected.text();
  }
  assert.equal(f.launches.length, 1);
});

test('initialization validates JSON-RPC request IDs before creating a worker', async t => {
  const f = await fixture(t);
  for (const id of [1.5, null]) {
    const response = await f.request({ body: { jsonrpc: '2.0', method: 'initialize', id,
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } } });
    assert.equal(response.status, 400); await response.text();
  }
  assert.equal(f.launches.length, 0);
  assert.equal(f.calls.length, 0);
});

test('client cancellation closes the upstream stream', async t => {
  const f = await fixture(t); f.state.streaming = true;
  const response = await f.request(); assert.equal(response.status, 200);
  await response.body.cancel();
  for (let attempt = 0; attempt < 20 && !f.state.streamClosed; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.state.streamClosed, true);
});
