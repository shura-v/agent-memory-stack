import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGatewayHandler, gatewayConfig } from '../dist/runtime/access-gateway.js';

const user = 'usr-alice';
function backend(options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const route = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ route, body, headers: init.headers });
    let data;
    if (route.endsWith('/auth/verify')) data = { valid: body.user_key === 'alice-key', user: { user_id: user } };
    else if (route.endsWith('/user/list-by-instance')) data = { total: options.inactive ? 0 : 1, items: options.inactive ? [] : [{ user_id: user, status: 'active' }] };
    else if (route.endsWith('/asset/get')) data = { asset_id: body.asset_id, asset_type: options.assetType ?? (body.asset_id.startsWith('cg-') ? 'code_graph' : 'llm_wiki'), team_id: 'team-one', status: 'active' };
    else if (route.endsWith('/acl/check')) data = { allowed: !options.denied && body.asset_id !== 'private' && body.asset_id !== 'restricted' && body.user_id === user };
    else if (route.endsWith('/team-member/get')) data = { user_id: user, team_id: 'team-one', status: options.removed ? 'removed' : 'active' };
    else {
      if (options.nativeResponse) return new Response(options.nativeResponse.body, { status: options.nativeResponse.status, headers: { 'content-type': 'application/json' } });
      data = { answer: 'allowed content' };
    }
    if (options.unavailable && route.includes('/meta/')) throw new Error('secret alice-key backend-secret');
    return Response.json({ code: 0, data });
  };
  return { fetcher, calls };
}

async function fixture(t, options = {}) {
  const upstream = backend(options);
  const config = gatewayConfig(options.withoutServiceKey ? {} : { CORE_API_KEY: 'backend-secret' });
  const server = http.createServer(createGatewayHandler(config, upstream.fetcher));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (body = {}, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${options.path || '/v3/tools/call'}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice-key', 'x-tdai-service-id': 'ams', ...options.headers },
    body: options.raw ?? JSON.stringify({ knowledge_id: 'wiki-one', tool_name: 'search', params: { query: 'fact' }, ...body }),
  });
  return { ...upstream, request, url: `http://127.0.0.1:${server.address().port}` };
}

test('authorized tool call derives identity and strips caller routing/auth fields', async t => {
  const f = await fixture(t);
  const resp = await f.request({ user_id: 'victim', team_id: 'victim-team', agent_id: 'privileged', service_url: 'https://attacker.example' });
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).data.answer, 'allowed content');
  const acl = f.calls.find(c => c.route.endsWith('/acl/check'));
  assert.deepEqual(acl.body, { user_id: user, asset_id: 'wiki-one', action: 'use' });
  const last = f.calls.at(-1);
  assert.equal(last.route, '/v3/tools/call');
  assert.equal(last.headers.authorization, 'Bearer backend-secret');
  assert.equal(last.headers['x-tdai-user-id'], user);
  assert.deepEqual(Object.keys(last.body).sort(), ['knowledge_id', 'params', 'tool_name']);
});

for (const id of ['private', 'restricted']) test(`rejects inaccessible ${id} asset before Knowledge forwarding`, async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ knowledge_id: id })).status, 403);
  assert.equal(f.calls.some(c => c.route.startsWith('/v3/tools/')), false);
});

test('removed team member is denied even if ACL permits owner', async t => {
  const f = await fixture(t, { removed: true });
  assert.equal((await f.request()).status, 403);
  assert.equal(f.calls.some(c => c.route.startsWith('/v3/tools/')), false);
});

test('inactive user is denied even when their API key is still valid', async t => {
  const f = await fixture(t, { inactive: true });
  assert.equal((await f.request({ user_id: 'active-victim' })).status, 403);
  const active = f.calls.find(call => call.route.endsWith('/user/list-by-instance'));
  assert.deepEqual(active.body, { user_ids: [user], status: 'active', limit: 1, offset: 0 });
  assert.equal(active.headers.authorization, 'Bearer backend-secret');
  assert.equal(f.calls.some(call => call.route.endsWith('/asset/get') || call.route.endsWith('/tools/call')), false);
});

test('list checks read permission and wrong instance or missing key never contacts Core', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({}, { headers: { 'x-tdai-service-id': 'other' } })).status, 403);
  assert.equal((await f.request({}, { headers: { authorization: '' } })).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request({}, { path: '/v3/tools/list' })).status, 200);
  assert.equal(f.calls.find(c => c.route.endsWith('/acl/check')).body.action, 'read');
});

test('gateway rejects oversized or malformed bodies and management routes', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({}, { raw: '[' })).status, 400);
  assert.equal((await f.request({}, { raw: 'x'.repeat(270_000) })).status, 413);
  assert.equal((await f.request({}, { path: '/v3/internal/llm-binding' })).status, 404);
  assert.equal((await f.request({}, { path: '/v3/tools/call?url=other' })).status, 404);
  assert.equal(f.calls.length, 0);
});

test('authorization outage fails closed without key or upstream error', async t => {
  const f = await fixture(t, { unavailable: true });
  const response = await f.request();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /alice-key|backend-secret/);
});

test('duplicate Authorization or service headers are rejected before Core authentication', async t => {
  const f = await fixture(t);
  for (const [name, value] of [['Authorization', 'Bearer alice-key'], ['x-tdai-service-id', 'ams']]) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(f.url + '/v3/tools/list', {
        method: 'POST', headers: ['Authorization', 'Bearer alice-key', 'x-tdai-service-id', 'ams',
          name, value, 'Content-Type', 'application/json'],
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end(JSON.stringify({ knowledge_id: 'wiki-one' }));
    });
    assert.equal(status, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request({}, { headers: { authorization: 'Bearer alice-key,Bearer-other' } })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('gateway configuration enforces the single ams instance', () => {
  assert.throws(() => gatewayConfig({ CORE_API_KEY: 'backend-secret', TDAI_SERVICE_ID: 'other' }), /must be ams/);
});

const nativeRoutes = [
  ...['search', 'explore', 'callers', 'callees', 'impact', 'node', 'status', 'files'].map(action => [`/v3/code-graph/${action}`, 'code_graph_id', 'cg-one']),
  ...['search', 'page/read', 'page/ls', 'graph'].map(action => [`/v3/wiki/${action}`, 'wiki_id', 'wiki-one']),
];
for (const [path, field, resource] of nativeRoutes) test(`stock MCP ${path} authorizes its resource and forwards its native body`, async t => {
  const f = await fixture(t);
  const body = { [field]: resource, query: 'literal ${query}', refs: ['page'], custom: { retained: true } };
  const response = await fetch(f.url + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice-key' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.find(call => call.route.endsWith('/acl/check')).body, { user_id: user, asset_id: resource, action: 'use' });
  const forwarded = f.calls.at(-1);
  assert.equal(forwarded.route, path);
  assert.deepEqual(forwarded.body, body);
  assert.equal(forwarded.headers['x-tdai-service-id'], 'ams');
  assert.equal(forwarded.headers.authorization, 'Bearer alice-key', 'stock forwarding never substitutes the Core service credential');
});

test('stock resource type, tenant, user status and live ACL remain enforced before forwarding', async t => {
  const state = {};
  const f = await fixture(t, state);
  const request = (patch = {}, headers = {}) => fetch(f.url + '/v3/wiki/search', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice-key', ...headers },
    body: JSON.stringify({ wiki_id: 'wiki-one', query: 'test', ...patch }),
  });
  assert.equal((await request()).status, 200);
  const initial = f.calls.filter(call => call.route === '/v3/wiki/search').length;
  state.denied = true; assert.equal((await request()).status, 403); state.denied = false;
  state.removed = true; assert.equal((await request()).status, 403); state.removed = false;
  state.inactive = true; assert.equal((await request()).status, 403); state.inactive = false;
  state.assetType = 'code_graph'; assert.equal((await request()).status, 403); delete state.assetType;
  assert.equal((await request({}, { 'x-tdai-service-id': 'other' })).status, 403);
  assert.equal((await request({}, { authorization: 'Bearer bob-key' })).status, 401);
  assert.equal((await request({ wiki_id: undefined, code_graph_id: 'cg-one' })).status, 400);
  assert.equal(f.calls.filter(call => call.route === '/v3/wiki/search').length, initial);
});

test('stock errors preserve response bytes and never retry with elevated credentials', async t => {
  const nativeResponse = { status: 403, body: '{"code":403,"message":"native denied","data":null}' };
  const f = await fixture(t, { nativeResponse });
  const response = await fetch(f.url + '/v3/wiki/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice-key' }, body: '{"wiki_id":"wiki-one","query":"test"}' });
  assert.equal(response.status, 403); assert.equal(await response.text(), nativeResponse.body);
  const calls = f.calls.filter(call => call.route === '/v3/wiki/search');
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.authorization, 'Bearer alice-key');
});

test('stock route bridge rejects create/delete/admin and unknown routes', async t => {
  const f = await fixture(t);
  for (const path of ['/v3/wiki/create', '/v3/wiki/delete', '/v3/code-graph/sync', '/v3/wiki/raw/read', '/v3/wiki/search?url=http://other', '/v3/wiki/new-tool']) {
    assert.equal((await f.request({}, { path })).status, 404);
  }
  assert.equal(f.calls.length, 0);
});

test('no Core service key still requires a valid user and resource permissions', async t => {
  const f = await fixture(t, { withoutServiceKey: true });
  assert.equal((await f.request()).status, 200);
  for (const call of f.calls) assert.equal(call.headers.authorization, undefined);
  assert.equal(f.calls.find(call => call.route.endsWith('/auth/verify')).headers['x-tdai-user-key'], 'alice-key');
  assert.equal((await f.request({}, { headers: { authorization: 'Bearer invalid-key' } })).status, 401);
  assert.equal((await f.request({ knowledge_id: 'private' })).status, 403);
});
