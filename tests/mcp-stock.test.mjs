import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { realpathSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpGateway } from '../dist/runtime/mcp-gateway.js';
import { McpWorkers, supergatewayFactory } from '../dist/runtime/mcp-workers.js';
import { createGatewayHandler, gatewayConfig } from '../dist/runtime/access-gateway.js';

const stockServer = process.env.AMS_STOCK_MCP ? realpathSync(process.env.AMS_STOCK_MCP) : undefined;
const listen = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

// Supply the selected revision's ordinary Knowledge build artifact. No copied
// upstream sources or substitute tool implementation is part of this fixture.
test('stock stdio MCP runs through real Supergateway with isolated users and resource authorization', { skip: !stockServer, timeout: 30_000 }, async t => {
  const state = { revoked: false, denied: false, removed: false };
  const forwarded = [], clients = [], children = [];
  const knowledge = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    forwarded.push({ path: req.url, headers: req.headers, body: JSON.parse(text) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0, message: 'native', data: { answer: 'stock query result' } }));
  });
  const knowledgeUrl = await listen(knowledge);
  const coreCalls = [];
  const fetcher = async (url, init) => {
    if (new URL(url).hostname !== 'core') return fetch(url, init);
    const path = new URL(url).pathname, body = JSON.parse(init.body);
    coreCalls.push({ path, body });
    let data;
    if (path.endsWith('/auth/verify')) data = { valid: ['alice', 'bob'].includes(body.user_key) && !(state.revoked && body.user_key === 'alice'), user: { user_id: body.user_key } };
    else if (path.endsWith('/user/list-by-instance')) data = { total: 1, items: [{ user_id: body.user_ids[0], status: 'active' }] };
    else if (path.endsWith('/asset/get')) data = { asset_id: body.asset_id, asset_type: body.asset_id.startsWith('wiki-') ? 'llm_wiki' : 'code_graph', team_id: 'team', status: 'active' };
    else if (path.endsWith('/acl/check')) data = { allowed: !state.denied && body.asset_id.endsWith(body.user_id) };
    else if (path.endsWith('/team-member/get')) data = { user_id: body.user_id, team_id: body.team_id, status: state.removed ? 'removed' : 'active' };
    else throw new Error(`Unexpected Core route: ${path}`);
    return Response.json({ code: 0, data });
  };
  const access = http.createServer(createGatewayHandler(gatewayConfig({ CORE_URL: 'http://core', CORE_API_KEY: 'core-service-key', KNOWLEDGE_URL: knowledgeUrl }), fetcher));
  const accessUrl = await listen(access);
  const factory = supergatewayFactory(accessUrl, stockServer);
  const workers = new McpWorkers(async key => { const worker = await factory(key); children.push(worker); return worker; });
  const gateway = createMcpGateway({ port: 8425, coreUrl: 'http://core', coreApiKey: 'core-service-key', knowledgeToolsUrl: accessUrl, serviceId: 'ams' }, { workers, fetcher });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    await workers.close();
    await Promise.all([close(gateway), close(access), close(knowledge)]);
    assert.ok(children.every(worker => !worker.alive()), 'all owned worker processes are stopped');
  });
  const connect = async key => {
    const client = new Client({ name: `agent-${key}`, version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
    clients.push(client); await client.connect(transport, { timeout: 5000 }); t.diagnostic(`connected ${key}`); return { client, transport };
  };
  const failed = await fetch(gatewayUrl + '/mcp', { method: 'POST', headers: {
    authorization: 'Bearer alice', 'content-type': 'application/json; charset=iso-8859-1', accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bad-encoding', version: '1' } } }) });
  assert.equal(failed.status, 415); await failed.text();
  for (let attempt = 0; attempt < 50 && children[0]?.alive(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(children[0].alive(), false, 'failed initialization reaps its worker and stock stdio child');
  const alice = await connect('alice'), bob = await connect('bob');
  const direct = new Client({ name: 'direct-stock-comparison', version: '1' });
  clients.push(direct);
  await direct.connect(new StdioClientTransport({ command: process.execPath, args: [stockServer],
    env: { KNOWLEDGE_API_URL: accessUrl, KNOWLEDGE_API_TOKEN: 'alice', LOG_LEVEL: 'error' }, stderr: 'ignore' }), { timeout: 5000 });
  const listing = await alice.client.listTools();
  assert.deepEqual(listing, await direct.listTools(), 'HTTP publishes exactly the running stock schemas');
  const tools = listing.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['code_search', 'code_explore', 'code_callers', 'code_callees', 'code_impact', 'code_node', 'code_status', 'code_files', 'wiki_search', 'wiki_read', 'wiki_list', 'wiki_graph']);
  for (const tool of tools) {
    const field = tool.name.startsWith('wiki_') ? 'wiki_id' : 'code_graph_id';
    const args = { [field]: `${field === 'wiki_id' ? 'wiki' : 'cg'}-alice`, query: 'fact', symbol: 'symbol', refs: ['page'] };
    const result = await alice.client.callTool({ name: tool.name, arguments: args });
    assert.equal(result.isError, false, tool.name);
    assert.deepEqual(forwarded.at(-1).body, args);
    assert.equal(forwarded.at(-1).headers['x-tdai-service-id'], 'ams');
    assert.equal(forwarded.at(-1).headers.authorization, 'Bearer alice');
  }
  assert.equal(children.filter(worker => worker.alive()).length, 2, 'one active worker per credential');
  const hijack = await fetch(gatewayUrl + '/mcp', { method: 'POST', headers: {
    authorization: 'Bearer bob', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': alice.transport.sessionId,
  }, body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 77 }) });
  assert.equal(hijack.status, 404); await hijack.text();
  const own = { name: 'wiki_search', arguments: { wiki_id: 'wiki-bob', query: 'fact' } };
  assert.equal((await bob.client.callTool(own)).isError, false);
  assert.equal(forwarded.at(-1).headers.authorization, 'Bearer bob');
  let count = forwarded.length;
  assert.equal((await bob.client.callTool({ ...own, arguments: { ...own.arguments, wiki_id: 'wiki-alice' } })).isError, true);
  assert.equal(forwarded.length, count, 'other user asset does not reach Knowledge');
  state.denied = true; assert.equal((await bob.client.callTool(own)).isError, true); state.denied = false;
  state.removed = true; assert.equal((await bob.client.callTool(own)).isError, true); state.removed = false;
  assert.equal(forwarded.length, count, 'ACL and team status are rechecked');
  state.revoked = true;
  await assert.rejects(alice.client.callTool({ name: 'wiki_search', arguments: { wiki_id: 'wiki-alice', query: 'fact' } }), /Invalid user key/);
  assert.equal(forwarded.length, count);
  assert.ok(coreCalls.some(call => call.path.endsWith('/acl/check') && call.body.action === 'use'));
});
