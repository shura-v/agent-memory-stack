import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { AccessError, isObject, requireSingleHeaders, bearerKey, userAuthorizer, type JsonObject } from './user-auth.js';

interface GatewayConfig {
  coreUrl: URL;
  knowledgeUrl: URL;
  coreApiKey: string;
  serviceId: string;
  bodyLimit: number;
  timeoutMs: number;
}
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// This is the external authorization boundary, not a copy of upstream tool schemas.
const stockRoutes = new Map<string, { field: 'wiki_id' | 'code_graph_id'; type: string }>([
  ...['search', 'explore', 'callers', 'callees', 'impact', 'node', 'status', 'files']
    .map(action => [`/v3/code-graph/${action}`, { field: 'code_graph_id', type: 'code_graph' }] as const),
  ...['search', 'page/read', 'page/ls', 'graph']
    .map(action => [`/v3/wiki/${action}`, { field: 'wiki_id', type: 'llm_wiki' }] as const),
]);

export function gatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const coreUrl = new URL(env.CORE_URL || 'http://core:8420');
  const knowledgeUrl = new URL(env.KNOWLEDGE_URL || 'http://knowledge:8421');
  for (const url of [coreUrl, knowledgeUrl]) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid internal service URL');
    }
  }
  if (!env.CORE_API_KEY) throw new Error('CORE_API_KEY is required');
  if (env.TDAI_SERVICE_ID && env.TDAI_SERVICE_ID !== 'ams') throw new Error('TDAI_SERVICE_ID must be ams');
  return { coreUrl, knowledgeUrl, coreApiKey: env.CORE_API_KEY,
    serviceId: env.TDAI_SERVICE_ID || 'ams', bodyLimit: 256 * 1024, timeoutMs: 10_000 };
}

function reply(res: ServerResponse, status: number, message: string, data: unknown = null): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ code: status === 200 ? 0 : status, message, data }));
}

async function readBody(req: IncomingMessage, limit: number): Promise<JsonObject> {
  if (Number(req.headers['content-length']) > limit) throw new AccessError(413, 'Request too large');
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const value of req) {
    const chunk: unknown = value;
    if (!Buffer.isBuffer(chunk)) throw new AccessError(400, 'Invalid request body');
    bytes += chunk.length;
    if (bytes > limit) throw new AccessError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isObject(value)) throw new Error();
    return value;
  } catch { throw new AccessError(400, 'Invalid JSON object'); }
}

export function createGatewayHandler(config: GatewayConfig, fetcher: typeof fetch = globalThis.fetch): Handler {
  const endpoint = (base: URL, route: string) => new URL(`${base.toString().replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`);
  const { core, authenticate } = userAuthorizer(config, fetcher);
  return async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(res, 200, 'ok');
      const stock = stockRoutes.get(req.url ?? '');
      if (req.method !== 'POST' || !req.url || (!stock && !['/v3/tools/list', '/v3/tools/call'].includes(req.url))) throw new AccessError(404, 'Not found');
      requireSingleHeaders(req);
      const tenant = req.headers['x-tdai-service-id'];
      if (tenant !== config.serviceId && (!stock || tenant !== undefined)) throw new AccessError(403, 'Access denied');
      const key = bearerKey(req);
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new AccessError(415, 'JSON required');
      const body = await readBody(req, config.bodyLimit);
      const resourceField = stock?.field ?? 'knowledge_id';
      const resource = body[resourceField];
      if (typeof resource !== 'string' || !/^[\w-]{1,200}$/.test(resource)) throw new AccessError(400, `Invalid ${resourceField}`);
      const isCall = req.url.endsWith('/call');
      if (isCall && (typeof body.tool_name !== 'string' || !body.tool_name || !isObject(body.params))) throw new AccessError(400, 'Invalid tool call');
      const userId = await authenticate(key);
      const asset = await core('asset/get', { asset_id: resource }, key);
      if (asset.asset_id !== resource || typeof asset.asset_type !== 'string' || !(stock ? [stock.type] : ['llm_wiki', 'code_graph']).includes(asset.asset_type) || asset.status === 'archived' || typeof asset.team_id !== 'string' || !asset.team_id) throw new AccessError(403, 'Access denied');
      const permission = await core('acl/check', { user_id: userId, asset_id: asset.asset_id, action: stock || isCall ? 'use' : 'read' }, key);
      if (permission.allowed !== true) throw new AccessError(403, 'Access denied');
      const member = await core('team-member/get', { team_id: asset.team_id, user_id: userId }, key);
      if (member.user_id !== userId || member.team_id !== asset.team_id || member.status !== 'active') throw new AccessError(403, 'Access denied');
      const outbound = stock ? body : { knowledge_id: resource, ...(isCall ? { tool_name: body.tool_name, params: body.params } : {}) };
      const resp = await fetcher(endpoint(config.knowledgeUrl, req.url), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
        headers: { 'content-type': 'application/json', 'x-tdai-service-id': config.serviceId, authorization: `Bearer ${stock ? key : config.coreApiKey}`,
          'x-tdai-user-id': userId, 'x-tdai-team-id': asset.team_id }, body: JSON.stringify(outbound),
      });
      if (stock) {
        // The native client owns its response/error semantics. Never retry with another identity.
        res.writeHead(resp.status, { 'content-type': resp.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
        res.end(await resp.text());
        return;
      }
      if (!resp.ok) throw new AccessError(502, 'Knowledge request failed');
      const result: unknown = await resp.json();
      if (!isObject(result) || result.code !== 0) throw new AccessError(502, 'Knowledge request failed');
      reply(res, 200, 'ok', result.data);
    } catch (err) {
      if (!res.headersSent) reply(res, (err instanceof AccessError) ? err.status : 503,
        (err instanceof AccessError) ? err.message : 'Service unavailable');
      else res.end();
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = http.createServer(createGatewayHandler(gatewayConfig()));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.ACCESS_PORT || 8080), '0.0.0.0');
}
