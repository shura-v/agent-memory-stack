/** Stack boundary: authenticate public bridge calls before using cached session identity. */
type SessionIds = { user_id: string; team_id: string; space_id?: string; user_key?: string };
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function amsPublicOrigin(name: 'AMS_KNOWLEDGE_URL' | 'AMS_PROXY_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an HTTP(S) origin`);
  return url.origin;
}

/** Explicit public routes, enforced inside MemoryProxy before its catch-all handlers. */
export function amsPublicRoute(method: string, url: string): boolean {
  const parsed = new URL(url);
  if (parsed.search || parsed.hash) return false;
  const path = parsed.pathname;
  if (method === 'GET') return path === '/health';
  if (method !== 'POST') return false;
  if (/^\/codex\/ams\/v1\/responses(?:\/compact)?$/.test(path)) return true;
  if (path === '/claude-code/ams/v1/messages') return true;
  if (/^\/(?:codebuddy|opencode|dsh|hermes)\/ams\/v1\/chat\/completions$/.test(path)) return true;
  if (/^\/memory-bridge\/v3\/(?:atomic\/(?:search|query)|conversation\/(?:search|query)|scenario\/(?:ls|read))$/.test(path)) return true;
  return /^\/skill-bridge\/v3\/skill\/(?:search|get|files\/(?:read|download)|extract)$/.test(path);
}

export async function amsGuardRequest(request: Request): Promise<Response | null> {
  if (!amsPublicRoute(request.method, request.url)) return Response.json({ error: 'Not found' }, { status: 404 });
  if (request.method === 'GET') return null;
  const bearer = request.headers.get('authorization');
  const apiKey = request.headers.get('x-api-key');
  const key = bearer ? /^Bearer ([^\s,]+)$/.exec(bearer)?.[1] : apiKey;
  if (!key || (apiKey && bearer && apiKey !== key)) return Response.json({ error: 'User key required' }, { status: 401 });
  const service = request.headers.get('x-tdai-service-id');
  if (service && service !== 'ams') return Response.json({ error: 'Access denied' }, { status: 403 });
  try {
    const auth = await amsMeta('auth/verify', { user_key: key }, key);
    if (auth.valid === true && isObject(auth.user) && typeof auth.user.user_id === 'string' && auth.user.user_id
      && await amsActiveUser(auth.user.user_id, key)) return null;
  } catch { /* Fail closed without returning Core errors. */ }
  return Response.json({ error: 'Access denied' }, { status: 401 });
}

export function amsAssertSessionOwner(state: unknown, userId: string): void {
  if (!isObject(state)) return;
  const session = isObject(state.sessionInfo) ? state.sessionInfo : undefined;
  const owner = session?.user_id ?? state.userId;
  if (typeof owner === 'string' && owner && owner !== userId) throw new Error('Session belongs to another user');
}

export async function amsMeta(route: string, body: JsonObject, key: string, internal = false): Promise<JsonObject> {
  const token = process.env.CORE_API_KEY;
  if (!token || !key) throw new Error('Authorization unavailable');
  const response = await fetch(`${(process.env.CORE_URL || 'http://core:8420').replace(/\/+$/, '')}/v3/${internal ? 'internal/' : ''}meta/${route}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`,
      'x-tdai-service-id': process.env.TDAI_SERVICE_ID || 'ams', 'x-tdai-user-key': key },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Access denied');
  const result: unknown = await response.json();
  if (!isObject(result) || result.code !== 0 || !isObject(result.data)) throw new Error('Access denied');
  return result.data;
}

async function amsActiveUser(userId: string, key: string): Promise<boolean> {
  const page = await amsMeta('user/list-by-instance', { user_ids: [userId], status: 'active', limit: 1, offset: 0 }, key, true);
  return page.total === 1 && Array.isArray(page.items) && page.items.length === 1
    && isObject(page.items[0]) && page.items[0].user_id === userId && page.items[0].status === 'active';
}

export async function amsAuthorizeBridge(
  header: (name: string) => string | undefined,
  ids: SessionIds,
): Promise<boolean> {
  try {
    const serviceId = process.env.TDAI_SERVICE_ID || 'ams';
    if (header('x-tdai-service-id') !== serviceId || ids.space_id !== serviceId) return false;
    const key = /^Bearer ([^\s]+)$/.exec(header('authorization') || '')?.[1];
    if (!key) return false;
    const auth = await amsMeta('auth/verify', { user_key: key }, key);
    if (auth.valid !== true || !isObject(auth.user) || !auth.user.user_id || auth.user.user_id !== ids.user_id) return false;
    if (!await amsActiveUser(ids.user_id, key)) return false;
    const member = await amsMeta('team-member/get', { team_id: ids.team_id, user_id: ids.user_id }, key);
    if (member.user_id !== ids.user_id || member.team_id !== ids.team_id || member.status !== 'active') return false;
    ids.user_key = key;
    return true;
  } catch { return false; }
}

export async function amsAssetAllowed(key: string | undefined, userId: string, assetId: string): Promise<boolean> {
  if (!key || !userId || !assetId) return false;
  try {
    const asset = await amsMeta('asset/get', { asset_id: assetId }, key);
    if (asset.asset_id !== assetId || asset.status === 'archived' || !asset.team_id) return false;
    const member = await amsMeta('team-member/get', { team_id: asset.team_id, user_id: userId }, key);
    if (member.user_id !== userId || member.team_id !== asset.team_id || member.status !== 'active') return false;
    const acl = await amsMeta('acl/check', { user_id: userId, asset_id: assetId, action: 'read' }, key);
    return acl.allowed === true;
  } catch { return false; }
}

export async function amsFilterSkills(text: string, ids: SessionIds): Promise<string> {
  try {
    const result: unknown = JSON.parse(text);
    if (!isObject(result)) throw new Error();
    if (result.code !== 0) return text;
    if (!isObject(result.data) || !Array.isArray(result.data.items)) throw new Error();
    const items: JsonObject[] = [];
    // Keep requests bounded; default bridge search returns at most 20 items.
    for (const item of result.data.items.slice(0, 100)) {
      if (isObject(item) && typeof item.skill_id === 'string' && await amsAssetAllowed(ids.user_key, ids.user_id, item.skill_id)) items.push(item);
    }
    result.data.items = items;
    if ('total' in result.data) result.data.total = items.length;
    return JSON.stringify(result);
  } catch { return JSON.stringify({ code: 503, message: 'Authorization unavailable', data: null }); }
}

/** Pinned Core handleListing emits one id-bearing line per skill. Discard unknown lines. */
export async function amsFilterListing(listing: string, key: string | undefined, userId: string): Promise<string> {
  const lines: string[] = [];
  for (const line of listing.split('\n').slice(0, 200)) {
    const id = /^- id=([\w-]+), name=/.exec(line)?.[1];
    if (id && await amsAssetAllowed(key, userId, id)) lines.push(line);
  }
  return lines.length ? '<available_skills>\n# Use the id field with skill_view.\n' + lines.join('\n') + '\n</available_skills>' : '';
}
