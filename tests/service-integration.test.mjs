import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService, knowledgeServiceRoutes } from '../dist/runtime/knowledge-service.js';
import { persistentIdentity, panelIdentity, serviceHeaders, authorizeCallback, fetchIdentity, IntegrationError } from '../dist/runtime/service-identity.js';
import { probeIntegration } from '../dist/runtime/integration.js';

const key = 'test-core-$literal';
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };

test('persistent identity survives re-entry and refuses corrupt state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-identity-test-'));
  try { const file = join(dir, 'identity.json'); const id = persistentIdentity(file); assert.equal(persistentIdentity(file), id); await writeFile(file, '{}'); assert.throws(() => persistentIdentity(file), /Invalid persistent/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('model probe checks the prefixed read-only API and distinguishes authentication and reachability', async () => {
  const config = { checks: [{ name: 'Model API', kind: 'model', url: 'https://model.example/prefix/v1', key }] };
  const modelFetch = async (url, init) => { assert.equal(url, 'https://model.example/prefix/v1/models'); assert.equal(init.method, undefined); assert.equal(init.redirect, 'manual'); return Response.json({ data: [] }); };
  assert.deepEqual(await probeIntegration(config, modelFetch), { pending: [] });
  assert.deepEqual(await probeIntegration(config, async () => { throw new Error('secret unreachable'); }), { pending: ['Model API'] });
  await assert.rejects(probeIntegration(config, async () => new Response('secret error', { status: 401 })), /Model authentication rejected/);
  await assert.rejects(probeIntegration(config, async () => new Response('', { status: 302 })), /Model endpoint rejected/);
  await assert.rejects(probeIntegration(config, async () => new Response('<html>wrong endpoint</html>')), /Invalid model API response/);
});

test('Knowledge service streams uploads through the fixed route boundary and gates mismatched peers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-service-test-')); const servers = [];
  let mode = 'ready'; let forwarded = 0; let panelEnv;
  const coreId = 'core-persistent-one';
  const core = http.createServer((req, res) => { assert.equal(req.url, '/core-prefix/ams/identity'); if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ coreId })); });
  const coreUrl = await listen(core) + '/core-prefix'; servers.push(core);
  const panel = http.createServer(async (req, res) => {
    assert.equal(req.url, '/panel-prefix/ams/identity');
    if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; }
    if (mode === 'pending') { res.writeHead(503); res.end(); return; }
    try { const identity = await panelIdentity('panel-one', panelEnv); if (mode === 'wrong-core') identity.coreId = 'different-core'; if (mode === 'wrong-knowledge') identity.knowledgeId = 'different-knowledge'; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(identity)); }
    catch { res.writeHead(503); res.end(); }
  });
  const panelUrl = await listen(panel) + '/panel-prefix'; servers.push(panel);
  const raw = http.createServer(async (req, res) => { forwarded++; assert.equal(req.headers['x-tdai-service-id'], 'ams'); assert.equal(req.headers.authorization, undefined); assert.ok(req.url.startsWith('/raw-prefix/v3/')); let bytes = 0; for await (const chunk of req) bytes += chunk.length; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 0, data: { bytes } })); });
  const knowledgeUrl = await listen(raw) + '/raw-prefix'; servers.push(raw);
  const service = createKnowledgeService({ port: 0, knowledgeUrl, coreUrl, panelUrl, coreApiKey: key, serviceId: 'ams', identityFile: join(dir, 'identity.json'), bodyLimit: 1024 * 1024 });
  const base = await listen(service); servers.push(service);
  panelEnv = { AMS_CORE_URL: coreUrl, AMS_CORE_API_KEY: key, AMS_KNOWLEDGE_SERVICE_URL: base, AMS_KNOWLEDGE_ENABLED: 'true' };
  const post = (path, options = {}) => fetch(base + path, { method: 'POST', headers: { ...serviceHeaders(key), 'content-type': 'application/json' }, body: '{}', ...options });
  try {
    await t.test('service credentials and exact tenant are mandatory', async () => {
      assert.equal((await post('/v3/wiki/list', { headers: {} })).status, 401);
      assert.equal((await post('/v3/wiki/list', { headers: { ...serviceHeaders('wrong'), 'content-type': 'application/json' } })).status, 401);
      assert.equal((await post('/v3/wiki/list', { headers: { ...serviceHeaders(key), 'x-tdai-service-id': 'other', 'content-type': 'application/json' } })).status, 403);
      const duplicate = await new Promise(resolve => { const request = http.request(base + '/v3/wiki/list', { method: 'POST', headers: ['Host', new URL(base).host, 'Authorization', `Bearer ${key}`, 'Authorization', `Bearer ${key}`, 'x-tdai-service-id', 'ams', 'content-type', 'application/json'] }, response => { response.resume(); resolve(response.statusCode); }); request.end('{}'); });
      assert.equal(duplicate, 401);
      assert.equal(forwarded, 0);
    });
    await t.test('allowlist includes every permitted operation and excludes route/query tricks', async () => {
      for (const path of knowledgeServiceRoutes) assert.equal((await post(path)).status, 200, path);
      for (const path of ['/v3/wiki/update-meta', '/v3/wiki/page/write', '/v3/llm-binding/set', '/v3/wiki/list?target=http://evil', '/v3/wiki/%6cist']) assert.equal((await post(path)).status, 404, path);
      assert.equal((await fetch(base + '/v3/wiki/list', { headers: serviceHeaders(key) })).status, 404);
    });
    await t.test('real upload bodies larger than the public tool limit stream without truncation', async () => {
      const body = JSON.stringify({ files: [{ content: 'a'.repeat(300 * 1024) }] });
      const response = await post('/v3/wiki/raw/write', { body }); assert.equal(response.status, 200); assert.equal((await response.json()).data.bytes, Buffer.byteLength(body));
      assert.equal((await post('/v3/wiki/raw/write', { body: 'a'.repeat(1024 * 1024 + 1) })).status, 413);
    });
    await t.test('pending peers and mismatched Core/Knowledge do not forward operations', async () => {
      const before = forwarded;
      for (const wrong of ['wrong-core', 'wrong-knowledge']) { mode = wrong; assert.equal((await post('/v3/wiki/create')).status, 409); }
      mode = 'pending'; assert.equal((await post('/v3/wiki/create')).status, 503);
      assert.equal((await fetch(base + '/health')).status, 200);
      assert.equal((await fetch(base + '/ams/identity', { headers: serviceHeaders(key) })).status, 200);
      assert.equal(forwarded, before);
      mode = 'ready'; assert.equal((await post('/v3/wiki/create')).status, 200);
    });
    await t.test('probe distinguishes stageable unavailable peers from fatal authentication or identity mismatch', async () => {
      const config = { checks: [{ name: 'Core', kind: 'core', url: coreUrl, key }], pairings: [{ knowledgeUrl: base, coreUrl, panelUrl, key }] };
      assert.deepEqual(await probeIntegration(config), { pending: [] });
      mode = 'pending'; assert.deepEqual(await probeIntegration(config), { pending: ['Knowledge/Panel pairing'] });
      mode = 'wrong-core'; await assert.rejects(probeIntegration(config), /identity mismatch/);
      mode = 'ready'; await assert.rejects(probeIntegration({ checks: [{ name: 'Core', kind: 'core', url: coreUrl, key: 'wrong' }] }), /authentication rejected/);
    });
    await t.test('callback service authentication binds the configured Knowledge and Core', async () => {
      const identity = await fetchIdentity(base, key);
      const request = headers => new Request('http://panel/api/v1/knowledge/status-callback', { method: 'POST', headers });
      const headers = { ...serviceHeaders(key), 'x-ams-core-id': coreId, 'x-ams-knowledge-id': identity.knowledgeId };
      await authorizeCallback(request(headers), 'panel-one', panelEnv);
      await assert.rejects(authorizeCallback(request({ ...headers, authorization: 'Bearer wrong' }), 'panel-one', panelEnv), error => error instanceof IntegrationError && error.status === 401);
      await assert.rejects(authorizeCallback(request({ ...headers, 'x-ams-knowledge-id': 'other' }), 'panel-one', panelEnv), /deployment mismatch/);
      await assert.rejects(authorizeCallback(request(headers), 'panel-one', { ...panelEnv, AMS_KNOWLEDGE_ENABLED: 'false' }), /disabled/);
    });
  } finally { for (const server of servers.reverse()) await close(server); await rm(dir, { recursive: true, force: true }); }
});
