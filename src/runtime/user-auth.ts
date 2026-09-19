import type { IncomingMessage } from 'node:http';
/** Build URLs for the stock Core API without adding an AMS service protocol. */
export function serviceEndpoint(base: string, route: string): string {
  return base.replace(/\/+$/, '') + '/' + route.replace(/^\/+/, '');
}

export type JsonObject = Record<string, unknown>;
export class AccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function requireSingleHeaders(req: IncomingMessage, names = ['authorization', 'x-tdai-service-id']): void {
  for (const name of names) {
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i]?.toLowerCase() === name) count++;
    if (count > 1) throw new AccessError(400, 'Duplicate request header');
  }
}
export function bearerKey(req: IncomingMessage): string {
  const match = /^Bearer ([^\s,]{1,4096})$/.exec(req.headers.authorization || '');
  if (!match) throw new AccessError(401, 'User key required');
  return match[1]!;
}
export interface UserAuthConfig { coreUrl: URL | string; coreApiKey: string; serviceId: string; timeoutMs?: number }
export function userAuthorizer(config: UserAuthConfig, fetcher: typeof fetch = fetch) {
  const core = async (route: string, body: JsonObject, key: string, internal = false): Promise<JsonObject> => {
    const response = await fetcher(serviceEndpoint(String(config.coreUrl), `/v3/${internal ? 'internal/' : ''}meta/${route}`), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.coreApiKey}`,
        'x-tdai-service-id': config.serviceId, 'x-tdai-user-key': key }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new AccessError(response.status < 500 ? 403 : 503, response.status < 500 ? 'Access denied' : 'Authorization unavailable');
    const envelope: unknown = await response.json();
    if (!isObject(envelope) || envelope.code !== 0 || !isObject(envelope.data)) throw new AccessError(403, 'Access denied');
    return envelope.data;
  };
  const authenticate = async (key: string): Promise<string> => {
    const auth = await core('auth/verify', { user_key: key }, key);
    if (auth.valid !== true || !isObject(auth.user) || typeof auth.user.user_id !== 'string' || !auth.user.user_id) throw new AccessError(401, 'Invalid user key');
    const userId = auth.user.user_id;
    const users = await core('user/list-by-instance', { user_ids: [userId], status: 'active', limit: 1, offset: 0 }, key, true);
    if (users.total !== 1 || !Array.isArray(users.items) || users.items.length !== 1 || !isObject(users.items[0])
      || users.items[0].user_id !== userId || users.items[0].status !== 'active') throw new AccessError(403, 'Access denied');
    return userId;
  };
  return { core, authenticate };
}
