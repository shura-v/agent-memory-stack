import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { IntegrationError, persistentIdentity, fetchIdentity, requirePairing, requireServiceAuth, serviceEndpoint } from './service-identity.js';

export interface KnowledgeServiceConfig {
  port: number; knowledgeUrl: string; coreUrl: string; coreApiKey: string; serviceId: string; panelUrl: string; identityFile: string;
  bodyLimit?: number; timeoutMs?: number;
}
export const knowledgeServiceRoutes = new Set([
  ...['create', 'get', 'ingest', 'delete', 'list', 'graph', 'search'].map(action => `/v3/wiki/${action}`),
  ...['ls', 'read', 'write', 'rm'].map(action => `/v3/wiki/raw/${action}`),
  ...['ls', 'read', 'rm'].map(action => `/v3/wiki/page/${action}`),
  ...['create', 'list', 'get', 'sync', 'delete', 'search', 'explore'].map(action => `/v3/code-graph/${action}`),
  '/v3/tools/list', '/v3/tools/call',
]);
function reply(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data));
}
function bounded(limit: number): Transform {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length; callback(bytes > limit ? new IntegrationError(413, 'Payload too large') : null, chunk);
  } });
}

/** Service boundary only. User authorization remains in the separate public tool gateway. */
export function createKnowledgeService(config: KnowledgeServiceConfig, fetcher: typeof fetch = fetch): http.Server {
  if (!config.coreApiKey || config.serviceId !== 'ams') throw new Error('Invalid Knowledge service authentication');
  for (const endpoint of [config.knowledgeUrl, config.coreUrl, config.panelUrl]) serviceEndpoint(endpoint, '/health');
  const knowledgeId = persistentIdentity(config.identityFile);
  const limit = config.bodyLimit ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512 * 1024 * 1024) throw new Error('Invalid Knowledge payload limit');
  const identity = async () => { const core = await fetchIdentity(config.coreUrl, config.coreApiKey, fetcher); if (core.panelId || core.knowledgeId) throw new IntegrationError(409, 'Expected Core service identity'); return { coreId: core.coreId, knowledgeId }; };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { status: 'ok' });
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
      requireServiceAuth(headers, config.coreApiKey, config.serviceId);
      if (req.method === 'GET' && req.url === '/ams/identity') return reply(res, 200, await identity());
      if (req.method === 'GET' && req.url === '/ams/integration') {
        const own = await identity(); const peer = await requirePairing(own, config.panelUrl, config.coreApiKey, fetcher);
        return reply(res, 200, { ...own, panelId: peer.panelId });
      }
      if (req.method !== 'POST' || !req.url || !knowledgeServiceRoutes.has(req.url)) throw new IntegrationError(404, 'Route unavailable');
      if (!/^application\/json(?:;|$)/i.test(headers.get('content-type') || '')) throw new IntegrationError(415, 'JSON required');
      if (Number(req.headers['content-length']) > limit) throw new IntegrationError(413, 'Payload too large');
      await requirePairing(await identity(), config.panelUrl, config.coreApiKey, fetcher);
      proxy(req, res, config, limit);
    } catch (error) {
      reply(res, error instanceof IntegrationError ? error.status : 503, { code: error instanceof IntegrationError ? error.status : 503, message: error instanceof IntegrationError ? error.message : 'Knowledge integration unavailable', data: null });
    }
  });
  server.requestTimeout = config.timeoutMs ?? 120_000;
  return server;
}
function proxy(req: IncomingMessage, res: ServerResponse, config: KnowledgeServiceConfig, limit: number): void {
  const url = new URL(serviceEndpoint(config.knowledgeUrl, req.url!));
  const transport = url.protocol === 'https:' ? https : http;
  const upstream = transport.request(url, { method: 'POST', headers: { 'content-type': req.headers['content-type']!, 'x-tdai-service-id': config.serviceId }, timeout: config.timeoutMs ?? 120_000 });
  const input = bounded(limit);
  const fail = (error: Error) => {
    upstream.destroy(); req.unpipe(input); input.destroy();
    if (!res.headersSent) reply(res, error instanceof IntegrationError ? error.status : 503, { code: error instanceof IntegrationError ? error.status : 503, message: 'Knowledge transfer failed', data: null });
    else res.destroy();
  };
  upstream.once('error', fail);
  upstream.once('timeout', () => fail(new IntegrationError(503, 'Knowledge timed out')));
  input.once('error', fail);
  req.once('aborted', () => upstream.destroy());
  res.once('close', () => { if (!res.writableEnded) upstream.destroy(); });
  upstream.once('response', response => {
    if ((response.statusCode || 0) >= 300 && (response.statusCode || 0) < 400) { response.destroy(); fail(new IntegrationError(502, 'Knowledge redirect rejected')); return; }
    const output = bounded(limit);
    output.once('error', fail); response.once('error', fail);
    res.writeHead(response.statusCode || 502, { 'content-type': response.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
    response.pipe(output).pipe(res);
  });
  req.pipe(input).pipe(upstream);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile(process.argv[2] || '/config/knowledge-service.json', 'utf8')) as KnowledgeServiceConfig;
  const server = createKnowledgeService(config);
  server.listen(config.port, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
