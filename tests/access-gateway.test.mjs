import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGatewayHandler, gatewayConfig } from '../dist/runtime/access-gateway.js';
import { amsAuthorizeBridge, amsAssetAllowed, amsFilterSkills, amsFilterListing, amsPublicRoute, amsPublicOrigin, amsGuardRequest, amsAssertSessionOwner } from '../patches/ams-access.ts';

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
    else if (route.endsWith('/asset/get')) data = { asset_id: body.asset_id, asset_type: 'llm_wiki', team_id: 'team-one', status: 'active' };
    else if (route.endsWith('/acl/check')) data = { allowed: !options.denied && body.asset_id !== 'private' && body.asset_id !== 'restricted' && body.user_id === user };
    else if (route.endsWith('/team-member/get')) data = { user_id: user, team_id: 'team-one', status: options.removed ? 'removed' : 'active' };
    else data = { answer: 'allowed content' };
    if (options.unavailable && route.includes('/meta/')) throw new Error('secret alice-key backend-secret');
    return Response.json({ code: 0, data });
  };
  return { fetcher, calls };
}

async function fixture(t, options = {}) {
  const upstream = backend(options);
  const config = gatewayConfig({ CORE_API_KEY: 'backend-secret' });
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

test('public MemoryProxy routes are bounded at its own entry point', () => {
  for (const path of ['/codex/ams/v1/responses', '/codex/ams/v1/responses/compact',
    '/codebuddy/ams/v1/chat/completions', '/hermes/ams/v1/chat/completions', '/claude-code/ams/v1/messages',
    '/memory-bridge/v3/atomic/search', '/skill-bridge/v3/skill/files/read']) {
    assert.equal(amsPublicRoute('POST', 'https://api.example' + path), true);
  }
  for (const path of ['/direct/v1/responses', '/codex/other/v1/responses', '/v3/instance/proxy-destroy',
    '/v3/admin/rate-limits', '/skill-bridge/v3/skill/delete', '/v3/internal/meta/user/init-admin']) {
    assert.equal(amsPublicRoute('POST', 'https://api.example' + path), false);
  }
  assert.equal(amsPublicRoute('GET', 'https://api.example/codex/ams/v1/responses'), false);
  assert.equal(amsPublicRoute('POST', 'https://api.example/codex/ams/v1/responses?target=other'), false);
});

test('tool origins accept HTTP and HTTPS hosts while rejecting non-origin URL parts', () => {
  for (const name of ['AMS_KNOWLEDGE_URL', 'AMS_PROXY_URL']) {
    const old = process.env[name];
    try {
      for (const value of ['https://knowledge.example', 'http://localhost:8422', 'http://192.168.1.20:8422',
        'http://[::1]:8422', 'http://memory.lan:8096']) {
        process.env[name] = value + '/';
        assert.equal(amsPublicOrigin(name), value);
      }
      for (const value of ['https://knowledge.example/v3', 'http://localhost:8422/v3',
        'https://user:secret@knowledge.example', 'http://user:secret@localhost:8422',
        'http://localhost:8422?key=value', 'https://knowledge.example#fragment', 'ftp://memory.lan']) {
        process.env[name] = value;
        assert.throws(() => amsPublicOrigin(name));
      }
    } finally { old === undefined ? delete process.env[name] : process.env[name] = old; }
  }
});

test('cached session ownership cannot change to another authenticated user', () => {
  const state = { userId: user, sessionInfo: { user_id: user } };
  assert.doesNotThrow(() => amsAssertSessionOwner(state, user));
  assert.throws(() => amsAssertSessionOwner(state, 'victim'), /another user/);
  assert.equal(state.userId, user);
});

test('patched bridge rejects stolen session, wrong instance and removed member', async t => {
  const previous = { fetch: globalThis.fetch, key: process.env.CORE_API_KEY, service: process.env.TDAI_SERVICE_ID };
  process.env.CORE_API_KEY = 'backend-secret';
  process.env.TDAI_SERVICE_ID = 'ams';
  t.after(() => { globalThis.fetch = previous.fetch; for (const [name, value] of [['CORE_API_KEY', previous.key], ['TDAI_SERVICE_ID', previous.service]]) value === undefined ? delete process.env[name] : process.env[name] = value; });
  globalThis.fetch = backend().fetcher;
  const request = new Request('https://api.example/codex/ams/v1/responses', { method: 'POST', headers: { authorization: 'Bearer alice-key' }, body: '{"model":"upstream-model"}' });
  assert.equal(await amsGuardRequest(request), null);
  assert.equal(request.bodyUsed, false, 'guard does not consume model body');
  assert.equal((await amsGuardRequest(new Request('https://api.example/direct/v1/responses', { method: 'POST' }))).status, 404);
  assert.equal((await amsGuardRequest(new Request('https://api.example/codex/ams/v1/responses', { method: 'POST' }))).status, 401);
  const headers = n => ({ authorization: 'Bearer alice-key', 'x-tdai-service-id': 'ams' })[n];
  const ids = { user_id: user, team_id: 'team-one', space_id: 'ams' };
  assert.equal(await amsAuthorizeBridge(headers, { ...ids, user_id: 'victim' }), false);
  assert.equal(await amsAuthorizeBridge(headers, { ...ids, space_id: 'other' }), false);
  assert.equal(await amsAuthorizeBridge(headers, ids), true);
  assert.equal(ids.user_key, 'alice-key');
  assert.equal(await amsAssetAllowed('alice-key', user, 'private'), false);
  const result = JSON.parse(await amsFilterSkills(JSON.stringify({ code: 0, data: { items: [{ skill_id: 'shared' }, { skill_id: 'private' }, { skill_id: 'restricted' }] } }), ids));
  assert.deepEqual(result.data.items, [{ skill_id: 'shared' }]);
  const listing = await amsFilterListing('<available_skills>\n- id=shared, name=Allowed, desc=Team procedure\n- id=private, name=Secret, desc=Hidden fact\nunknown continuation\n</available_skills>', 'alice-key', user);
  assert.match(listing, /Team procedure/);
  assert.doesNotMatch(listing, /Secret|Hidden fact|unknown continuation/);
  globalThis.fetch = backend({ removed: true }).fetcher;
  assert.equal(await amsAuthorizeBridge(headers, ids), false);
  globalThis.fetch = backend({ inactive: true }).fetcher;
  assert.equal(await amsAuthorizeBridge(headers, ids), false);
  assert.equal((await amsGuardRequest(new Request('https://api.example/hermes/ams/v1/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer alice-key' },
  }))).status, 401);
});
