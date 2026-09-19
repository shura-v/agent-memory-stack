import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonObject = Record<string, unknown>;
export interface InitializeOptions {
  coreUrl?: string;
  coreApiKey?: string;
  adminKey?: string;
  mode: 'initialize' | 'check';
  serviceId?: string;
  fetchImpl?: typeof fetch;
}
export interface BootstrapResult {
  initialized: true;
  created: boolean;
  userId: string;
  teamId?: string;
  agentId?: string;
}
class BootstrapError extends Error {}
export class BootstrapRequiredError extends BootstrapError {
  readonly code = 'SETUP_REQUIRED';
  constructor() {
    super('No active system administrator exists. Run ams to finish initial setup; ordinary startup does not create an administrator.');
    this.name = 'BootstrapRequiredError';
  }
}
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function listPage(data: unknown, endpoint: string): { items: JsonObject[]; total: number } {
  if (!object(data) || !Array.isArray(data.items) || !data.items.every(object)
    || typeof data.total !== 'number' || !Number.isSafeInteger(data.total)
    || data.total < data.items.length || (data.total > 0 && data.items.length === 0)) {
    throw new BootstrapError(`Invalid list response from ${endpoint}; bootstrap stopped.`);
  }
  return { items: data.items, total: data.total };
}
function validateAdminKey(key: unknown): asserts key is string {
  // Upstream trims x-tdai-user-key. Preserve custom values that survive that path.
  try {
    if (typeof key !== 'string' || !key || key !== key.trim()
      || new Headers({ 'x-tdai-user-key': key }).get('x-tdai-user-key') !== key) throw new Error();
  } catch {
    throw new BootstrapError('Supply a nonempty admin key that can be transmitted unchanged in an HTTP header, without leading or trailing whitespace, through initialization stdin.');
  }
}

/** Check existing state or explicitly initialize using a transient supplied key. */
export async function initialize({ coreUrl = 'http://core:8420', coreApiKey = '', adminKey, mode,
  serviceId = 'ams', fetchImpl = globalThis.fetch }: InitializeOptions): Promise<BootstrapResult> {
  if (!nonempty(serviceId) || !serviceId.trim()) throw new BootstrapError('SERVICE_ID is required.');
  if (mode !== 'initialize' && mode !== 'check') throw new BootstrapError('Bootstrap mode must be initialize or check.');
  if (mode === 'initialize') validateAdminKey(adminKey);
  if (mode === 'check' && adminKey !== undefined) throw new BootstrapError('Check mode does not accept an administrator credential.');
  let base: URL;
  try {
    base = new URL(coreUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error();
  } catch {
    throw new BootstrapError('CORE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  async function request(endpoint: string, body: JsonObject, options: { userKey?: string; allowConflict?: boolean } = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(endpoint, base), {
        method: 'POST', headers: {
          'content-type': 'application/json', ...(coreApiKey ? { authorization: `Bearer ${coreApiKey}` } : {}),
          'x-tdai-service-id': serviceId,
          ...(options.userKey ? { 'x-tdai-user-key': options.userKey } : {}),
        },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new BootstrapError(`Core request failed at ${endpoint}. Check Core availability and network settings, then rerun setup.`);
    }
    if (response.status === 409 && options.allowConflict) return { conflict: true };
    if (!response.ok) throw new BootstrapError(`Core returned HTTP ${response.status} at ${endpoint}. Check authentication and Core logs, then rerun setup.`);
    let envelope: unknown;
    try { envelope = await response.json(); } catch { throw new BootstrapError(`Invalid JSON from ${endpoint}; bootstrap stopped.`); }
    if (!object(envelope) || envelope.code !== 0) throw new BootstrapError(`Core rejected ${endpoint}; check Core logs, then rerun setup.`);
    return envelope.data;
  }
  const usersEndpoint = '/v3/internal/meta/user/list-by-instance';
  if (mode === 'check') {
    const users = listPage(await request(usersEndpoint, {
      user_type: 'system_admin', status: 'active', limit: 1, offset: 0,
    }), usersEndpoint);
    const user = users.items[0];
    if (!user || user.user_type !== 'system_admin' || user.status !== 'active' || !nonempty(user.user_id)) throw new BootstrapRequiredError();
    return { initialized: true, created: false, userId: user.user_id };
  }
  validateAdminKey(adminKey);
  const users = listPage(await request(usersEndpoint, { limit: 1, offset: 0 }), usersEndpoint);
  let created = false;
  if (users.total === 0) {
    const result = await request('/v3/internal/meta/user/init-admin', {
      username: 'admin', user_key: adminKey,
    }, { allowConflict: true });
    created = !(object(result) && result.conflict === true);
  }
  // Both known existing state and a 409 race must authenticate before repair.
  const verified = await request('/v3/meta/auth/verify', { user_key: adminKey });
  const user = object(verified) ? verified.user : undefined;
  if (!object(verified) || verified.valid !== true || !object(user) || user.user_type !== 'system_admin'
    || !nonempty(user.user_id) || !nonempty(user.username)) {
    throw new BootstrapError('The supplied key does not authenticate a system administrator in this instance. Use the existing administrator credential or restore access; setup will not replace users or keys.');
  }
  const userId = user.user_id;
  // auth/verify exposes no user status, and the SQLite key lookup checks key
  // status only. Confirm the administrator itself is active before any repair.
  const activeAdmins = listPage(await request(usersEndpoint, {
    user_ids: [userId], user_type: 'system_admin', status: 'active', limit: 1, offset: 0,
  }), usersEndpoint);
  if (activeAdmins.total !== 1 || activeAdmins.items[0]?.user_id !== userId
    || activeAdmins.items[0]?.status !== 'active' || activeAdmins.items[0]?.user_type !== 'system_admin') {
    throw new BootstrapError('The supplied key belongs to an inactive or unavailable administrator. Restore administrator access before repairing default entities.');
  }
  const auth = { userKey: adminKey };
  async function ensureEntity(kind: 'team' | 'agent', filter: JsonObject, input: JsonObject, idField: 'team_id' | 'agent_id'): Promise<string> {
    const endpoint = `/v3/meta/${kind}/list`;
    const lookup = async () => listPage(await request(endpoint, { ...filter, limit: 100, offset: 0 }, auth), endpoint);
    let result = await lookup();
    if (result.total === 0) {
      await request(`/v3/meta/${kind}/create`, input, auth);
      result = await lookup();
    }
    const entity = result.items[0];
    if (result.total !== 1 || result.items.length !== 1 || !entity || !nonempty(entity[idField])
      || entity.name !== input.name || entity.owner_user_id !== userId || entity.status !== 'active'
      || (kind === 'agent' && (entity.team_id !== input.team_id || entity.visibility !== 'team'))) {
      throw new BootstrapError(`Default ${kind} is missing, ambiguous, or inactive. Repair its ownership, visibility and active status in Panel, then rerun setup.`);
    }
    return entity[idField];
  }
  const teamId = await ensureEntity('team', { user_id: userId, name: 'default-team' }, {
    name: 'default-team', owner_user_id: userId, status: 'active', description: 'Default team for agent-memory-stack.',
  }, 'team_id');
  const agentName = `default-agent-${user.username}`;
  const agentId = await ensureEntity('agent', { team_id: teamId, owner_user_id: userId, name: agentName }, {
    team_id: teamId, owner_user_id: userId, name: agentName, status: 'active', visibility: 'team', prompt: '',
    description: 'Default assistant for agent-memory-stack.',
    metadata_json: JSON.stringify({ ui: { role_prompt: '', rules_prompt: '' } }),
  }, 'agent_id');
  return { initialized: true, created, userId, teamId, agentId };
}

async function readInitializationInput(): Promise<string> {
  if (process.stdin.isTTY) throw new BootstrapError('Initialization requires a JSON object on stdin; use ams.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new BootstrapError('Initialization stdin exceeds the allowed size.');
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    throw new BootstrapError('Initialization stdin must contain a JSON object with adminKey.');
  }
  if (!object(value) || Object.keys(value).length !== 1) throw new BootstrapError('Initialization stdin must contain only adminKey.');
  validateAdminKey(value.adminKey);
  return value.adminKey;
}
async function main(): Promise<void> {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || (mode !== 'check' && mode !== 'initialize')) throw new BootstrapError('Usage: bootstrap check|initialize; administrator credentials are accepted only through stdin.');
  try { await import('./environment.js'); } catch {
    throw new BootstrapError('Cannot load AMS_ENV_FILE. Check the generated environment configuration.');
  }
  const result = await initialize({
    coreUrl: process.env.CORE_URL, coreApiKey: process.env.CORE_API_KEY ?? '', serviceId: process.env.SERVICE_ID, mode,
    ...(mode === 'initialize' ? { adminKey: await readInitializationInput() } : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof BootstrapError ? error.message : 'Unexpected failure; check Core availability and generated configuration.';
    process.stderr.write(`Bootstrap failed: ${message}\n`);
    process.exitCode = error instanceof BootstrapRequiredError ? 2 : 1;
  });
}
