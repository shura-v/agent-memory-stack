// Transport fixture only. Stock tool behavior is exercised by mcp-stock.test.mjs.
import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, InitializeRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
const control = async () => JSON.parse(await readFile(new URL(process.env.KNOWLEDGE_API_URL), 'utf8'));
const initial = await control();
await appendFile(new URL(process.env.KNOWLEDGE_API_URL + '.started'), `${process.pid}\n`);
while ((await control()).holdInitialization && !initial.failInitialization) await delay(5);
const server = new Server({ name: 'transport-fixture', version: '1' }, { capabilities: { tools: {} }, instructions: 'Fixture instructions' });
if (initial.failInitialization) server.setRequestHandler(InitializeRequestSchema, () => { throw new McpError(ErrorCode.InvalidRequest, 'Fixture initialization rejected'); });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'transport_probe', description: 'Transport fixture', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  await appendFile(new URL(process.env.KNOWLEDGE_API_URL + '.called'), `${process.pid}\n`);
  if (request.params.arguments?.crash) process.exit(1);
  if (request.params.arguments?.delay) await delay(request.params.arguments.delay);
  if (request.params.arguments?.protocolError) throw new McpError(ErrorCode.InvalidParams, 'Fixture request rejected', { field: 'value' });
  if (request.params.arguments?.toolError) return { isError: true, content: [{ type: 'text', text: 'Fixture tool failure' }] };
  return { content: [{ type: 'text', text: JSON.stringify({
    pid: process.pid, tokenHash: createHash('sha256').update(process.env.KNOWLEDGE_API_TOKEN).digest('hex'),
    resources: process.getActiveResourcesInfo(), value: request.params.arguments?.value,
  }) }] };
});
await server.connect(new StdioServerTransport());
