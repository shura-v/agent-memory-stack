import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { runProcess } from '../../dist/runtime/process.js';

// Called only by the isolated runtime smoke fixture. All writes use stock HTTP
// APIs and remain in that fixture's volumes; no ingest or model operation runs.
export async function assertStockResource({ directory, provider, engine, admin, env }) {
  const project = `ams-${createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 10)}`;
  const ids = (await runProcess({ command: engine, args: ['ps', '-q', '--filter',
    `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=core'],
  })).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, 'isolated project must have one running Core');
  assert.match(ids[0], /^[a-f0-9]+$/, 'container identity is an engine ID');
  const request = async (service, route, body) => {
    const core = service === 'core';
    const response = JSON.parse(await runProcess({ command: engine, args: ['exec', '-i', ids[0], 'node', '--input-type=module', '-e',
      "let input='';for await(const chunk of process.stdin)input+=chunk;const q=JSON.parse(input);const r=await fetch(q.url,{method:'POST',headers:q.headers,body:JSON.stringify(q.body),signal:AbortSignal.timeout(15000)});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null}process.stdout.write(JSON.stringify({status:r.status,body}));"],
      input: JSON.stringify({ url: `${core ? 'http://127.0.0.1:8420/v3/meta' : 'http://knowledge:8421/v3'}/${route}`,
        headers: { 'content-type': 'application/json', 'x-tdai-service-id': 'ams',
          ...(core ? { authorization: `Bearer ${env.CORE_API_KEY}`, 'x-tdai-user-key': admin } : {}) }, body }),
      label: `${provider} stock ${service} ${route}`, timeoutMs: 20_000,
    }));
    assert.ok(response.status >= 200 && response.status < 300,
      `stock ${service} ${route}: HTTP ${response.status}, code ${response.body?.code}`);
    assert.equal(response.body?.code, 0, `stock ${service} ${route}: nonzero envelope`);
    return response.body.data;
  };
  const verified = await request('core', 'auth/verify', { user_key: admin });
  assert.equal(verified.valid, true);
  const userId = verified.user?.user_id;
  assert.equal(typeof userId, 'string');
  const teams = await request('core', 'team/list', { user_id: userId, name: 'default-team', limit: 10, offset: 0 });
  const team = teams.items?.find(item => item.name === 'default-team');
  assert.equal(typeof team?.team_id, 'string', 'bootstrap default team is available');
  const name = `ams-stock-mcp-${randomUUID()}`;
  const wiki = await request('knowledge', 'wiki/create', { team_id: team.team_id, user_id: userId, name });
  assert.equal(typeof wiki.wiki_id, 'string', 'stock Knowledge returns the created Wiki ID');

  const client = new Client({ name: 'ams-stock-resource-check', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${env.MCP_PORT}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${admin}` } },
  });
  try {
    await client.connect(transport, { timeout: 15_000 });
    const invocation = { name: 'wiki_list', arguments: { wiki_id: wiki.wiki_id } };
    const denied = await client.callTool(invocation, undefined, { timeout: 15_000 });
    assert.equal(denied.isError, true, 'Knowledge-only resource is inaccessible before Core registration');
    assert.match(denied.content?.find(item => item.type === 'text')?.text ?? '', /Access denied/,
      'unregistered resource is denied by the external authorization boundary');
    const asset = await request('core', 'asset/create', {
      asset_id: wiki.wiki_id, team_id: team.team_id, asset_type: 'llm_wiki', name,
      owner_user_id: userId, source_type: 'manual', visibility: 'team',
    });
    assert.equal(asset.asset_id, wiki.wiki_id);
    const result = await client.callTool(invocation, undefined, { timeout: 15_000 });
    assert.equal(result.isError, false, 'stock MCP wiki_list succeeds after stock Core registration');
    const content = result.content?.find(item => item.type === 'text')?.text;
    assert.equal(typeof content, 'string');
    assert.deepEqual(JSON.parse(content), { items: [] }, 'new Wiki can be queried without ingestion or an LLM');
    return { userId, teamId: team.team_id, wikiId: wiki.wiki_id, nativeWikiCreated: true,
      unregisteredResourceDenied: true, stockMcpWikiList: true, pageCount: 0, inference: 'not invoked' };
  } finally {
    try { await transport.terminateSession(); } catch {}
    await client.close();
  }
}
