import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AccessError, isObject, requireSingleHeaders, bearerKey, userAuthorizer } from './user-auth.js';
import { fetchIdentity, serviceEndpoint } from './service-identity.js';
import { InitializeRequestSchema, JSONRPCRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpWorkers, supergatewayFactory, type McpWorker } from './mcp-workers.js';

export interface McpGatewayConfig {
  port: number; coreUrl: string; coreApiKey: string; knowledgeToolsUrl: string; serviceId: string;
}
function reply(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
}
async function body(req: IncomingMessage): Promise<{ bytes: Buffer; initialize: boolean }> {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AccessError(415, 'JSON required');
  const limit = 100 * 1024; // Matches the pinned Supergateway Express JSON parser.
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
  return { bytes, initialize };
}
function requestHeaders(req: IncomingMessage, config: McpGatewayConfig): string | undefined {
  requireSingleHeaders(req, ['authorization', 'x-tdai-service-id', 'mcp-session-id', 'mcp-protocol-version', 'origin', 'host', 'content-type', 'last-event-id']);
  if (req.headers['x-tdai-service-id'] !== undefined && req.headers['x-tdai-service-id'] !== config.serviceId) throw new AccessError(403, 'Service identity rejected');
  const origin = req.headers.origin;
  if (origin) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new AccessError(403, 'Origin rejected'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.host !== req.headers.host || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new AccessError(403, 'Origin rejected');
  }
  const session = req.headers['mcp-session-id'];
  if (session !== undefined && (typeof session !== 'string' || !/^[\w-]{1,128}$/.test(session))) throw new AccessError(400, 'Invalid session header');
  const protocol = req.headers['mcp-protocol-version'];
  if (protocol !== undefined && (typeof protocol !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(protocol))) throw new AccessError(400, 'Invalid protocol header');
  if (req.method === 'POST') {
    const accept = (req.headers.accept || '').toLowerCase();
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) throw new AccessError(406, 'Accept JSON and event streams');
  }
  if (req.headers['content-encoding'] !== undefined) throw new AccessError(415, 'Encoded requests unavailable');
  return session;
}
function forward(req: IncomingMessage, res: ServerResponse, worker: McpWorker, bytes: Buffer | undefined, session: string | undefined): Promise<boolean> {
  return new Promise(resolve => {
    const headers: http.OutgoingHttpHeaders = {};
    for (const name of ['content-type', 'accept', 'mcp-protocol-version', 'last-event-id']) {
      const value = req.headers[name]; if (typeof value === 'string') headers[name] = value;
    }
    if (session) headers['mcp-session-id'] = session;
    if (bytes) headers['content-length'] = bytes.length;
    const upstream = http.request(worker.url, { method: req.method, headers, timeout: 300_000 });
    let done = false, initialized = false;
    const finish = () => { if (!done) { done = true; resolve(initialized); } };
    const fail = () => { upstream.destroy(); reply(res, 503, 'MCP transport unavailable'); finish(); };
    upstream.once('error', fail);
    upstream.once('timeout', fail);
    req.once('aborted', () => { upstream.destroy(); finish(); });
    res.once('close', () => { upstream.destroy(); finish(); });
    upstream.once('response', response => {
      const status = response.statusCode || 502;
      if (status >= 300 && status < 400) { response.destroy(); fail(); return; }
      const returned = response.headers['mcp-session-id'];
      if (returned !== undefined && (typeof returned !== 'string' || !/^[\w-]{1,128}$/.test(returned) || (session && returned !== session))) {
        response.destroy(); fail(); return;
      }
      if (!session && status >= 200 && status < 300 && typeof returned === 'string') {
        worker.sessions.set(returned, { touched: Date.now(), active: 0 }); initialized = true;
      }
      if (session && ((req.method === 'DELETE' && status >= 200 && status < 300) || status === 404)) worker.sessions.delete(session);
      const output: http.OutgoingHttpHeaders = { 'cache-control': 'no-store', 'x-accel-buffering': 'no' };
      for (const name of ['content-type', 'mcp-session-id', 'mcp-protocol-version']) {
        const value = response.headers[name]; if (typeof value === 'string') output[name] = value;
      }
      response.once('error', fail);
      response.once('aborted', fail);
      res.once('finish', finish);
      if (session && status === 400) {
        // The pinned Supergateway reports a lost session as 400. MCP clients
        // need 404 to reinitialize; unrelated request errors must stay intact.
        const chunks: Buffer[] = []; let size = 0;
        const inspect = (chunk: Buffer) => {
          chunks.push(chunk); size += chunk.length;
          if (size > 64 * 1024) {
            response.off('data', inspect);
            res.writeHead(status, output);
            for (const buffered of chunks) res.write(buffered);
            chunks.length = 0;
            response.pipe(res);
          }
        };
        response.on('data', inspect);
        response.once('end', () => {
          if (res.headersSent || res.destroyed) return;
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          let missing = (req.method === 'GET' || req.method === 'DELETE') && text === 'Invalid or missing session ID';
          if (req.method === 'POST') {
            try {
              const value: unknown = JSON.parse(text);
              missing = isObject(value) && value.jsonrpc === '2.0' && value.id === null && isObject(value.error)
                && value.error.code === -32000 && value.error.message === 'Bad Request: No valid session ID provided';
            } catch { /* Preserve non-JSON upstream errors. */ }
          }
          if (missing) {
            worker.sessions.delete(session);
            reply(res, 404, 'Session unavailable');
          } else {
            res.writeHead(status, output); res.end(bytes);
          }
        });
        return;
      }
      res.writeHead(status, output);
      response.pipe(res);
    });
    upstream.end(bytes);
  });
}
export function createMcpGateway(config: McpGatewayConfig, options: { fetcher?: typeof fetch; workers?: McpWorkers } = {}): http.Server {
  if (!config.coreApiKey || config.serviceId !== 'ams' || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid MCP configuration');
  serviceEndpoint(config.coreUrl, '/health'); serviceEndpoint(config.knowledgeToolsUrl, '/health');
  const fetcher = options.fetcher ?? fetch;
  const workers = options.workers ?? new McpWorkers(supergatewayFactory(config.knowledgeToolsUrl, config.serviceId));
  const auth = userAuthorizer(config, fetcher);
  const server = http.createServer(async (req, res) => {
    let release: (() => void) | undefined;
    try {
      if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return; }
      if (req.url !== '/mcp' || !['POST', 'GET', 'DELETE'].includes(req.method || '')) throw new AccessError(404, 'Not found');
      const session = requestHeaders(req, config);
      const key = bearerKey(req);
      const payload = req.method === 'POST' ? await body(req) : undefined;
      if (!session && !payload?.initialize) throw new AccessError(400, 'Session required');
      if (session && payload?.initialize) throw new AccessError(400, 'Session already initialized');
      if (req.method !== 'POST' && (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0)) throw new AccessError(400, 'Unexpected request body');
      const userId = await auth.authenticate(key);
      const [core, knowledge] = await Promise.all([fetchIdentity(config.coreUrl, config.coreApiKey, fetcher), fetchIdentity(config.knowledgeToolsUrl, config.coreApiKey, fetcher)]);
      if (core.knowledgeId || core.panelId || knowledge.coreId !== core.coreId || !knowledge.knowledgeId || knowledge.panelId) throw new AccessError(503, 'Knowledge integration unavailable');
      const context = createHash('sha256').update(JSON.stringify([userId, key])).digest('hex');
      const lease = await workers.acquire(context, key); release = lease.release;
      if (req.aborted || res.destroyed) return;
      const worker = lease.worker;
      for (const [id, saved] of worker.sessions) {
        if (!saved.active && Date.now() - saved.touched >= 300_000) worker.sessions.delete(id);
      }
      if (session && !worker.sessions.has(session)) throw new AccessError(404, 'Session unavailable');
      if (!session && worker.sessions.size + worker.pending >= 8) throw new AccessError(429, 'MCP session capacity reached');
      const savedSession = session ? worker.sessions.get(session) : undefined;
      if (savedSession) savedSession.active++;
      if (!session) worker.pending++;
      try {
        const initialized = await forward(req, res, worker, payload?.bytes, session);
        // A failed initialization may leave an adapter behind. Reap only an otherwise
        // unused worker: other sessions and concurrent initializations share this process.
        if (!session && !initialized && worker.sessions.size === 0 && worker.pending === 1) await lease.discard();
      }
      finally {
        if (!session) worker.pending--;
        if (savedSession) { savedSession.active--; savedSession.touched = Date.now(); }
      }
    } catch (error) { reply(res, error instanceof AccessError ? error.status : 503, error instanceof AccessError ? error.message : 'MCP unavailable'); }
    finally { release?.(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  server.once('close', () => void workers.close().catch(() => {}));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(process.argv[2] || '/config/mcp.json', 'utf8')) as McpGatewayConfig;
  const workers = new McpWorkers(supergatewayFactory(config.knowledgeToolsUrl, config.serviceId));
  const server = createMcpGateway(config, { workers });
  server.listen(config.port, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(); server.closeAllConnections();
    void workers.close().finally(() => process.exit(0));
  });
}
