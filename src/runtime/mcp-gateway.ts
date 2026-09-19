import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AccessError, isObject, requireSingleHeaders, bearerKey, userAuthorizer } from './user-auth.js';
import { serviceEndpoint } from './user-auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { InitializeRequestSchema, JSONRPCRequestSchema, McpError, ResultSchema } from '@modelcontextprotocol/sdk/types.js';

export interface McpGatewayConfig {
  port: number; coreUrl: string; coreApiKey: string; knowledgeToolsUrl: string; serviceId: string;
}
function reply(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AccessError(415, 'JSON required');
  const charset = /;\s*charset=([^;]+)/i.exec(req.headers['content-type'] || '')?.[1]?.trim().replaceAll('"', '').toLowerCase();
  if (charset && charset !== 'utf-8' && charset !== 'utf8') throw new AccessError(415, 'UTF-8 JSON required');
  const limit = 100 * 1024;
  if (Number(req.headers['content-length']) > limit) throw new AccessError(413, 'Request too large');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk)) throw new AccessError(400, 'Invalid body');
    size += chunk.length;
    if (size > limit) throw new AccessError(413, 'Request too large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new AccessError(400, 'Invalid JSON'); }
  if (!isObject(value) || value.jsonrpc !== '2.0') throw new AccessError(400, 'JSON-RPC object required');
  const initialize = value.method === 'initialize';
  if (initialize && (!InitializeRequestSchema.safeParse(value).success || !JSONRPCRequestSchema.safeParse(value).success)) throw new AccessError(400, 'Invalid initialization');
  return value;
}
function requestHeaders(req: IncomingMessage, config: McpGatewayConfig): void {
  requireSingleHeaders(req, ['authorization', 'x-tdai-service-id', 'mcp-protocol-version', 'origin', 'host', 'content-type']);
  if (req.headers['x-tdai-service-id'] !== undefined && req.headers['x-tdai-service-id'] !== config.serviceId) throw new AccessError(403, 'Service identity rejected');
  const origin = req.headers.origin;
  if (origin) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new AccessError(403, 'Origin rejected'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.host !== req.headers.host || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new AccessError(403, 'Origin rejected');
  }
  const protocol = req.headers['mcp-protocol-version'];
  if (protocol !== undefined && (typeof protocol !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(protocol))) throw new AccessError(400, 'Invalid protocol header');
  if (req.method === 'POST') {
    const accept = (req.headers.accept || '').toLowerCase();
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) throw new AccessError(406, 'Accept JSON and event streams');
  }
  if (req.headers['content-encoding'] !== undefined) throw new AccessError(415, 'Encoded requests unavailable');
}
export function createMcpGateway(config: McpGatewayConfig, options: { fetcher?: typeof fetch; stockServer?: string } = {}): http.Server {
  if (config.serviceId !== 'ams' || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid MCP configuration');
  serviceEndpoint(config.coreUrl, '/health'); serviceEndpoint(config.knowledgeToolsUrl, '/health');
  const auth = userAuthorizer(config, options.fetcher ?? fetch);
  const active: Array<{ evict: () => void; released: Promise<void> }> = [];
  let admission = Promise.resolve();
  const acquire = (signal: AbortSignal, evict: () => void): Promise<(() => void) | undefined> => {
    const admitted = admission.then(async () => {
      if (signal.aborted) return undefined;
      while (active.length >= 64) {
        const oldest = active[0]!;
        oldest.evict();
        await oldest.released;
        if (signal.aborted) return undefined;
      }
      let resolveReleased!: () => void;
      let held = true;
      const entry = { evict, released: new Promise<void>(resolve => { resolveReleased = resolve; }) };
      active.push(entry);
      return () => {
        if (!held) return;
        held = false;
        const index = active.indexOf(entry);
        if (index !== -1) active.splice(index, 1);
        resolveReleased();
      };
    });
    admission = admitted.then(() => {}, () => {});
    return admitted;
  };
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController();
    let client: Client | undefined;
    let bridge: Server | undefined;
    let payload: unknown;
    let closing: Promise<void> | undefined;
    let release: (() => void) | undefined;
    const close = () => {
      if (closing) return closing;
      if (!client && !bridge) return Promise.resolve();
      return closing = Promise.all([client?.close(), bridge?.close()]).then(() => {});
    };
    const disconnected = () => { abort.abort(); void close().catch(() => {}); };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    try {
      if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return; }
      if (req.url !== '/mcp' || !['POST', 'GET', 'DELETE'].includes(req.method || '')) throw new AccessError(404, 'Not found');
      requestHeaders(req, config);
      const key = bearerKey(req);
      payload = req.method === 'POST' ? await body(req) : undefined;
      if (req.method !== 'POST' && (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0)) throw new AccessError(400, 'Unexpected request body');
      await auth.authenticate(key);
      if (abort.signal.aborted) return;
      // Stateless requests have no resumable stream or session to delete.
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        throw new AccessError(405, 'Method not allowed');
      }
      release = await acquire(abort.signal, () => {
        abort.abort();
        if (!res.writableEnded && !res.destroyed) reply(res, 503, 'MCP capacity reclaimed');
        void close().catch(() => {});
      });
      if (!release || abort.signal.aborted) return;
      client = new Client({ name: 'ams-mcp', version: '1' });
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [options.stockServer ?? '/opt/knowledge/dist/mcp/server.mjs'],
        env: { NODE_ENV: 'production', KNOWLEDGE_API_TOKEN: key, KNOWLEDGE_API_URL: config.knowledgeToolsUrl, LOG_LEVEL: 'error' },
        stderr: 'ignore',
      }), { signal: abort.signal });
      if (abort.signal.aborted) return;
      const native = client;
      bridge = new Server(native.getServerVersion()!, {
        capabilities: native.getServerCapabilities(), instructions: native.getInstructions(),
      });
      bridge.fallbackRequestHandler = (request, extra) => native.request(request, ResultSchema, { signal: extra.signal });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await bridge.connect(transport);
      if (abort.signal.aborted) return;
      const finished = new Promise<void>(resolve => { res.once('finish', resolve); res.once('close', resolve); });
      res.setHeader('cache-control', 'no-store');
      const interrupted = new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
      await Promise.race([transport.handleRequest(req, res, payload), interrupted]);
      if (abort.signal.aborted) return;
      await finished;
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof McpError && !res.headersSent) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: isObject(payload) ? payload.id ?? null : null,
          error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } }));
      } else reply(res, error instanceof AccessError ? error.status : 503, error instanceof AccessError ? error.message : 'MCP unavailable');
    } finally {
      await close().catch(() => {});
      release?.();
      req.off('aborted', disconnected); res.off('close', disconnected);
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(process.argv[2] || '/config/mcp.json', 'utf8')) as McpGatewayConfig;
  const server = createMcpGateway(config);
  server.listen(config.port, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(); server.closeAllConnections();
  });
}
