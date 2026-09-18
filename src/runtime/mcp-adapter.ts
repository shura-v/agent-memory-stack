import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

type JsonObject = Record<string, unknown>;
export interface McpAdapterConfig {
  knowledgeUrl: URL;
  userKey: string;
  serviceId: string;
}

const requestLimit = 256 * 1024;
const responseLimit = 4 * 1024 * 1024;
const requestTimeoutMs = 15_000;
const knowledgeId = { type: 'string', pattern: '^[\\w-]{1,200}$', description: 'Knowledge resource identifier from Panel (Wiki or code resource).' };
const tools: Tool[] = [
  {
    name: 'list_knowledge_tools',
    description: 'List available tools and their argument schemas for a Knowledge resource you can access. Requires its explicit Knowledge resource identifier.',
    inputSchema: { type: 'object', properties: { knowledge_id: knowledgeId }, required: ['knowledge_id'], additionalProperties: false },
  },
  {
    name: 'call_knowledge_tool',
    description: 'Call a tool returned by list_knowledge_tools for the same Knowledge resource. Use the listed tool name and argument schema. Access is checked for every call.',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge_id: knowledgeId,
        tool_name: { type: 'string', minLength: 1, maxLength: 200, description: 'Exact tool name returned by list_knowledge_tools.' },
        params: { type: 'object', description: 'Arguments matching the selected tool schema.' },
      },
      required: ['knowledge_id', 'tool_name', 'params'], additionalProperties: false,
    },
  },
];

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mcpAdapterConfig(env: NodeJS.ProcessEnv = process.env): McpAdapterConfig {
  const userKey = env.AMS_MCP_USER_KEY || '';
  const serviceId = env.AMS_MCP_SERVICE_ID || '';
  try {
    const knowledgeUrl = new URL(env.AMS_MCP_KNOWLEDGE_URL || '');
    if (!['http:', 'https:'].includes(knowledgeUrl.protocol) || knowledgeUrl.username || knowledgeUrl.password
      || knowledgeUrl.search || knowledgeUrl.hash || !/^[\x21-\x7e]{1,4096}$/.test(userKey) || userKey.includes(',')
      || !/^[\w-]{1,200}$/.test(serviceId)) throw new Error();
    return { knowledgeUrl, userKey, serviceId };
  } catch {
    throw new Error('Invalid MCP adapter configuration');
  }
}

function failure(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) throw new Error();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createMcpAdapter(config: McpAdapterConfig, fetcher: typeof fetch = globalThis.fetch): Server {
  const server = new Server({ name: 'ams-knowledge', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    if (name !== 'list_knowledge_tools' && name !== 'call_knowledge_tool') return failure('Unknown Knowledge tool');
    const isCall = name === 'call_knowledge_tool';
    const allowed = isCall ? ['knowledge_id', 'tool_name', 'params'] : ['knowledge_id'];
    if (!isObject(args) || Object.keys(args).some(key => !allowed.includes(key))
      || typeof args.knowledge_id !== 'string' || !/^[\w-]{1,200}$/.test(args.knowledge_id)
      || (isCall && (typeof args.tool_name !== 'string' || !args.tool_name.trim() || args.tool_name.length > 200
        || /[\x00-\x1f\x7f]/.test(args.tool_name) || !isObject(args.params)))) return failure('Invalid Knowledge tool arguments');
    try {
      const body = JSON.stringify({ knowledge_id: args.knowledge_id, ...(isCall ? { tool_name: args.tool_name, params: args.params } : {}) });
      if (Buffer.byteLength(body) > requestLimit) return failure('Knowledge tool arguments exceed the size limit');
      const url = new URL(`${config.knowledgeUrl.toString().replace(/\/+$/, '')}/v3/tools/${isCall ? 'call' : 'list'}`);
      const response = await fetcher(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([extra.signal, AbortSignal.timeout(requestTimeoutMs)]),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.userKey}`, 'x-tdai-service-id': config.serviceId },
        body,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return failure(response.status === 401 || response.status === 403 ? 'Knowledge access denied' : 'Knowledge request failed');
      }
      const result = await responseJson(response);
      if (!isObject(result) || result.code !== 0 || !Object.hasOwn(result, 'data')) return failure('Knowledge request failed');
      if (isObject(result.data) && typeof result.data.text === 'string' && typeof result.data.isError === 'boolean') {
        return { content: [{ type: 'text', text: result.data.text || '(empty result)' }], isError: result.data.isError };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.data) }], isError: false };
    } catch {
      return failure('Knowledge request failed');
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = mcpAdapterConfig();
    delete process.env.AMS_MCP_USER_KEY;
    const server = createMcpAdapter(config);
    await server.connect(new StdioServerTransport());
  } catch {
    process.stderr.write('MCP adapter could not start\n');
    process.exitCode = 1;
  }
}
