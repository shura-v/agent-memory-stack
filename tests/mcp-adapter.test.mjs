import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpAdapter, mcpAdapterConfig } from '../dist/runtime/mcp-adapter.js';

const config = () => mcpAdapterConfig({
  AMS_MCP_USER_KEY: 'alice-user-key', AMS_MCP_SERVICE_ID: 'ams', AMS_MCP_KNOWLEDGE_URL: 'https://protected.example/knowledge/',
  CORE_API_KEY: 'never-forward-this',
});

async function fixture(t, fetcher) {
  const server = createMcpAdapter(config(), fetcher);
  const client = new Client({ name: 'test-agent', version: '1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('MCP discovers explicit resource-scoped tools and forwards only the caller identity and protected contract', async t => {
  const requests = [];
  const client = await fixture(t, async (url, init) => {
    requests.push({ url: String(url), ...init });
    return Response.json({ code: 0, data: { tools: [{ name: 'search', params: { query: 'string' } }] } });
  });
  const listing = await client.listTools();
  assert.deepEqual(listing.tools.map(tool => tool.name), ['list_knowledge_tools', 'call_knowledge_tool']);
  assert.deepEqual(listing.tools[1].inputSchema.required, ['knowledge_id', 'tool_name', 'params']);
  assert.equal(listing.tools[0].inputSchema.additionalProperties, false);
  const listed = await client.callTool({ name: 'list_knowledge_tools', arguments: { knowledge_id: 'wiki-one' } });
  assert.equal(listed.isError, false);
  assert.equal(JSON.parse(listed.content[0].text).tools[0].name, 'search');
  await client.callTool({ name: 'call_knowledge_tool', arguments: { knowledge_id: 'wiki-one', tool_name: 'search', params: { query: 'fact', limit: 4 } } });
  assert.equal(requests[0].url, 'https://protected.example/knowledge/v3/tools/list');
  assert.equal(requests[1].url, 'https://protected.example/knowledge/v3/tools/call');
  assert.deepEqual(JSON.parse(requests[0].body), { knowledge_id: 'wiki-one' });
  assert.deepEqual(JSON.parse(requests[1].body), { knowledge_id: 'wiki-one', tool_name: 'search', params: { query: 'fact', limit: 4 } });
  for (const request of requests) {
    assert.deepEqual(request.headers, { 'content-type': 'application/json', authorization: 'Bearer alice-user-key', 'x-tdai-service-id': 'ams' });
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    assert.doesNotMatch(request.body, /never-forward-this|alice-user-key/);
  }
});

test('MCP rejects missing, invalid, privileged, and oversized arguments before forwarding', async t => {
  let calls = 0;
  const client = await fixture(t, async () => { calls++; throw new Error('Must not run'); });
  for (const request of [
    { name: 'wiki_delete', arguments: { knowledge_id: 'wiki-one' } },
    { name: 'list_knowledge_tools' },
    { name: 'list_knowledge_tools', arguments: { knowledge_id: '../private' } },
    { name: 'list_knowledge_tools', arguments: { knowledge_id: 'wiki-one', user_id: 'admin' } },
    { name: 'call_knowledge_tool', arguments: { knowledge_id: 'wiki-one', tool_name: 'search', params: [] } },
    { name: 'call_knowledge_tool', arguments: { knowledge_id: 'wiki-one', tool_name: 'search\n', params: {} } },
    { name: 'call_knowledge_tool', arguments: { knowledge_id: 'wiki-one', tool_name: 'search', params: { query: 'x'.repeat(256 * 1024) } } },
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.equal(calls, 0);
});

test('MCP sanitizes access denial, invalid envelopes, and transport failures without retries', async t => {
  let calls = 0;
  const responses = [
    () => new Response('alice-user-key private service details', { status: 403 }),
    () => new Response('private service details', { status: 502 }),
    () => Response.json({ code: 1, message: 'alice-user-key private failure' }),
    () => Response.json({ code: 0 }),
    () => new Response('not-json alice-user-key'),
    () => { throw new Error('https://private.example alice-user-key'); },
    () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
  ];
  const client = await fixture(t, async () => responses[calls++]());
  for (let index = 0; index < responses.length; index++) {
    const result = await client.callTool({ name: 'list_knowledge_tools', arguments: { knowledge_id: 'private' } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, index === 0 ? 'Knowledge access denied' : 'Knowledge request failed');
  }
  assert.equal(calls, responses.length);
});

test('MCP preserves Knowledge tool errors and empty results', async t => {
  let calls = 0;
  const client = await fixture(t, async () => Response.json({ code: 0, data: calls++ === 0
    ? { text: 'Unknown search index', isError: true } : { text: '', isError: false } }));
  const request = { name: 'call_knowledge_tool', arguments: { knowledge_id: 'wiki-one', tool_name: 'search', params: {} } };
  assert.deepEqual(await client.callTool(request), { content: [{ type: 'text', text: 'Unknown search index' }], isError: true });
  assert.deepEqual(await client.callTool(request), { content: [{ type: 'text', text: '(empty result)' }], isError: false });
});

test('MCP adapter requires private worker credentials and a valid protected endpoint', () => {
  const env = { AMS_MCP_USER_KEY: 'alice-user-key', AMS_MCP_SERVICE_ID: 'ams', AMS_MCP_KNOWLEDGE_URL: 'http://access:8422' };
  for (const patch of [
    { AMS_MCP_USER_KEY: undefined }, { AMS_MCP_USER_KEY: 'key\r\nheader: value' },
    { AMS_MCP_USER_KEY: 'key,other' }, { AMS_MCP_SERVICE_ID: '' },
    { AMS_MCP_KNOWLEDGE_URL: 'file:///tmp/socket' },
    { AMS_MCP_KNOWLEDGE_URL: 'https://user:password@protected.example' },
    { AMS_MCP_KNOWLEDGE_URL: 'https://protected.example?key=secret' },
  ]) assert.throws(() => mcpAdapterConfig({ ...env, ...patch }), /^Error: Invalid MCP adapter configuration$/);
  assert.equal(mcpAdapterConfig(env).knowledgeUrl.href, 'http://access:8422/');
});
