import { readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class IntegrationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export type Identity = { coreId: string; knowledgeId?: string; panelId?: string };

/** Initialized only by owned services at startup; network probes never create identities. */
export function persistentIdentity(path = process.env.AMS_IDENTITY_FILE || '/data/ams-identity.json'): string {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ id: randomUUID() }) + '\n', { flag: 'wx', mode: 0o600 });
  try { linkSync(temporary, path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  finally { unlinkSync(temporary); }
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.id)) throw new Error('Invalid persistent service identity');
  return value.id;
}

export function serviceEndpoint(base: string, route: string): string {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid service endpoint');
  return url.href.replace(/\/+$/, '') + '/' + route.replace(/^\/+/, '');
}
export function serviceHeaders(key: string, serviceId = 'ams'): Record<string, string> {
  if (!key || serviceId !== 'ams') throw new Error('Service authentication is not configured');
  return { authorization: `Bearer ${key}`, 'x-tdai-service-id': serviceId };
}
export function requireServiceAuth(headers: Headers, key: string, serviceId = 'ams'): void {
  const actual = Buffer.from(headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${key}`);
  if (!key || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new IntegrationError(401, 'Service authentication required');
  if (serviceId !== 'ams' || headers.get('x-tdai-service-id') !== serviceId) throw new IntegrationError(403, 'Service identity rejected');
}
export async function fetchIdentity(base: string, key: string, fetcher: typeof fetch = fetch): Promise<Identity> {
  let response: Response;
  const endpoint = serviceEndpoint(base, '/ams/identity'); const headers = serviceHeaders(key);
  try { response = await fetcher(endpoint, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) }); }
  catch { throw new IntegrationError(503, 'Integration peer unavailable'); }
  if ([401, 403].includes(response.status)) throw new IntegrationError(response.status, 'Integration authentication rejected');
  if (response.status >= 500) throw new IntegrationError(503, 'Integration peer unavailable');
  if (!response.ok) throw new IntegrationError(409, 'Integration identity endpoint rejected');
  let identity: unknown;
  try { identity = await response.json(); } catch { throw new IntegrationError(409, 'Invalid integration identity'); }
  if (!identity || typeof identity !== 'object' || !('coreId' in identity) || typeof identity.coreId !== 'string' || !identity.coreId) throw new IntegrationError(409, 'Invalid integration identity');
  return identity as Identity;
}
export async function panelIdentity(panelId: string, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<Identity> {
  const core = await fetchIdentity(env.AMS_CORE_URL || '', env.AMS_CORE_API_KEY || '', fetcher);
  if (core.knowledgeId || core.panelId) throw new IntegrationError(409, 'Expected Core service identity');
  if (env.AMS_KNOWLEDGE_ENABLED === 'false') return { coreId: core.coreId, panelId };
  const knowledge = await fetchIdentity(env.AMS_KNOWLEDGE_SERVICE_URL || '', env.AMS_CORE_API_KEY || '', fetcher);
  if (!knowledge.knowledgeId || knowledge.panelId || knowledge.coreId !== core.coreId) throw new IntegrationError(409, 'Core and Knowledge identity mismatch');
  return { coreId: core.coreId, knowledgeId: knowledge.knowledgeId, panelId };
}
export async function requirePairing(knowledge: Identity, panelUrl: string, key: string, fetcher: typeof fetch = fetch): Promise<Identity> {
  const panel = await fetchIdentity(panelUrl, key, fetcher);
  if (!panel.panelId || !knowledge.knowledgeId || panel.knowledgeId !== knowledge.knowledgeId || panel.coreId !== knowledge.coreId) throw new IntegrationError(409, 'Knowledge and Panel identity mismatch');
  return panel;
}
export async function callbackHeaders(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const identity = await fetchIdentity(env.AMS_KNOWLEDGE_SERVICE_URL || '', env.AMS_CORE_API_KEY || '');
  if (!identity.knowledgeId) throw new IntegrationError(409, 'Knowledge identity missing');
  return { ...serviceHeaders(env.AMS_CORE_API_KEY || ''), 'content-type': 'application/json', 'x-ams-core-id': identity.coreId, 'x-ams-knowledge-id': identity.knowledgeId };
}
export async function authorizeCallback(request: Request, panelId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  requireServiceAuth(request.headers, env.AMS_CORE_API_KEY || '');
  if (env.AMS_KNOWLEDGE_ENABLED === 'false') throw new IntegrationError(404, 'Knowledge is disabled');
  const identity = await panelIdentity(panelId, env);
  if (request.headers.get('x-ams-core-id') !== identity.coreId || request.headers.get('x-ams-knowledge-id') !== identity.knowledgeId) throw new IntegrationError(409, 'Callback deployment mismatch');
}
export async function panelIdentityResponse(request: Request, panelId: string): Promise<Response> {
  try { requireServiceAuth(request.headers, process.env.AMS_CORE_API_KEY || ''); return Response.json(await panelIdentity(panelId)); }
  catch (error) { return Response.json({ error: 'Panel integration unavailable' }, { status: error instanceof IntegrationError ? error.status : 503 }); }
}
export async function callbackDenied(request: Request, panelId: string): Promise<Response | null> {
  try { await authorizeCallback(request, panelId); return null; }
  catch (error) { return Response.json({ code: error instanceof IntegrationError ? error.status : 503, message: 'Callback rejected', data: null }, { status: error instanceof IntegrationError ? error.status : 503 }); }
}
export async function coreIdentityRoute(req: IncomingMessage, res: ServerResponse, coreId: string): Promise<void> {
  try {
    const headers = new Headers();
    for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
    requireServiceAuth(headers, process.env.AMS_CORE_API_KEY || '');
    if (req.method !== 'GET') throw new IntegrationError(405, 'Method not allowed');
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ coreId }));
  } catch (error) { res.writeHead(error instanceof IntegrationError ? error.status : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Service identity unavailable' })); }
}
