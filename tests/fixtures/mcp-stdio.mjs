// Transport fixture only. Stock tool behavior is exercised by mcp-stock.test.mjs.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'transport-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'transport_probe', description: 'Transport fixture', inputSchema: { type: 'object' } }] }));
await server.connect(new StdioServerTransport());
