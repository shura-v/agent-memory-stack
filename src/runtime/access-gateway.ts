import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

interface GatewayConfig {
  coreUrl: URL;
  knowledgeUrl: URL;
  coreApiKey: string;
  serviceId: string;
  bodyLimit: number;
  timeoutMs: number;
}
type JsonObject = Record<string, unknown>;
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

class AccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function gatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const coreUrl = new URL(env.CORE_URL || 'http://core:8420');
  const knowledgeUrl = new URL(env.KNOWLEDGE_URL || 'http://knowledge-service:8423');
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

function requireSingleHeaders(req: IncomingMessage): void {
  for (const name of ['authorization', 'x-tdai-service-id']) {
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i]?.toLowerCase() === name) count++;
    }
    if (count > 1) throw new AccessError(400, 'Duplicate authentication header');
  }
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
  const core = async (route: string, body: JsonObject, key: string, internal = false): Promise<JsonObject> => {
    const resp = await fetcher(endpoint(config.coreUrl, `/v3/${internal ? 'internal/' : ''}meta/${route}`), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.coreApiKey}`,
        'x-tdai-service-id': config.serviceId, 'x-tdai-user-key': key }, body: JSON.stringify(body),
    });
    if (!resp.ok) throw new AccessError(resp.status < 500 ? 403 : 503, resp.status < 500 ? 'Access denied' : 'Authorization unavailable');
    const env: unknown = await resp.json();
    if (!isObject(env) || env.code !== 0 || !isObject(env.data)) throw new AccessError(403, 'Access denied');
    return env.data;
  };
  return async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return reply(res, 200, 'ok');
      if (req.method !== 'POST' || !req.url || !['/v3/tools/list', '/v3/tools/call'].includes(req.url)) throw new AccessError(404, 'Not found');
      requireSingleHeaders(req);
      if (req.headers['x-tdai-service-id'] !== config.serviceId) throw new AccessError(403, 'Access denied');
      const match = /^Bearer ([^\s,]+)$/.exec(req.headers.authorization || '');
      if (!match) throw new AccessError(401, 'User key required');
      const key = match[1];
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new AccessError(415, 'JSON required');
      const body = await readBody(req, config.bodyLimit);
      if (typeof body.knowledge_id !== 'string' || !/^[\w-]{1,200}$/.test(body.knowledge_id)) throw new AccessError(400, 'Invalid knowledge_id');
      const isCall = req.url.endsWith('/call');
      if (isCall && (typeof body.tool_name !== 'string' || !body.tool_name || !isObject(body.params))) throw new AccessError(400, 'Invalid tool call');
      const auth = await core('auth/verify', { user_key: key }, key);
      if (auth.valid !== true || !isObject(auth.user) || typeof auth.user.user_id !== 'string' || !auth.user.user_id) throw new AccessError(401, 'Invalid user key');
      const userId = auth.user.user_id;
      const users = await core('user/list-by-instance', { user_ids: [userId], status: 'active', limit: 1, offset: 0 }, key, true);
      if (users.total !== 1 || !Array.isArray(users.items) || users.items.length !== 1 || !isObject(users.items[0])
        || users.items[0].user_id !== userId || users.items[0].status !== 'active') throw new AccessError(403, 'Access denied');
      const asset = await core('asset/get', { asset_id: body.knowledge_id }, key);
      if (asset.asset_id !== body.knowledge_id || typeof asset.asset_type !== 'string' || !['llm_wiki', 'code_graph'].includes(asset.asset_type) || asset.status === 'archived' || typeof asset.team_id !== 'string' || !asset.team_id) throw new AccessError(403, 'Access denied');
      const permission = await core('acl/check', { user_id: userId, asset_id: asset.asset_id, action: isCall ? 'use' : 'read' }, key);
      if (permission.allowed !== true) throw new AccessError(403, 'Access denied');
      const member = await core('team-member/get', { team_id: asset.team_id, user_id: userId }, key);
      if (member.user_id !== userId || member.team_id !== asset.team_id || member.status !== 'active') throw new AccessError(403, 'Access denied');
      const outbound = { knowledge_id: body.knowledge_id, ...(isCall ? { tool_name: body.tool_name, params: body.params } : {}) };
      const resp = await fetcher(endpoint(config.knowledgeUrl, isCall ? '/v3/tools/call' : '/v3/tools/list'), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
        headers: { 'content-type': 'application/json', 'x-tdai-service-id': config.serviceId, authorization: `Bearer ${config.coreApiKey}`,
          'x-tdai-user-id': userId, 'x-tdai-team-id': asset.team_id }, body: JSON.stringify(outbound),
      });
      if (!resp.ok) throw new AccessError(502, 'Knowledge request failed');
      const result: unknown = await resp.json();
      if (!isObject(result) || result.code !== 0) throw new AccessError(502, 'Knowledge request failed');
      reply(res, 200, 'ok', result.data);
    } catch (err) {
      if (!res.headersSent) reply(res, err instanceof AccessError ? err.status : 503,
        err instanceof AccessError ? err.message : 'Service unavailable');
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
