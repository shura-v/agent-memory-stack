import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Provider } from './compose.js';
import { DeploymentError } from './errors.js';
import { runProcess } from './process.js';
import type { Runner } from './process.js';

export type ConnectionKey = {
  userId: string; username: string; userType: string;
  keyId: string; name: string; suffix: string;
};
type KeyRequest = { operation: 'list' } | { operation: 'read'; keyId: string };

/** Self-contained so the same read-only query can run inside an existing Core image. */
export async function queryConnectionKeys(databasePath: string, request: KeyRequest): Promise<ConnectionKey[] | string> {
  if (request?.operation !== 'list' && (request?.operation !== 'read' || typeof request.keyId !== 'string' || !request.keyId)) {
    throw new Error('Invalid key lookup request');
  }
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const active = (expires: unknown) => expires === null || expires === ''
      || typeof expires === 'string' && Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();
    const join = "FROM meta_user_keys k JOIN meta_users u ON u.user_id = k.user_id WHERE k.status = 'active' AND u.status = 'active'";
    if (request.operation === 'read') {
      const key = database.prepare(`SELECT k.key_value, k.expires_at ${join} AND k.key_id = ?`).get(request.keyId);
      if (!key || !active(key.expires_at) || typeof key.key_value !== 'string' || !key.key_value) throw new Error('Key is unavailable');
      return key.key_value;
    }
    const keys = database.prepare(`SELECT u.user_id AS userId, u.username, u.user_type AS userType,
      k.key_id AS keyId, COALESCE(k.name, '') AS name, substr(k.key_value, -4) AS suffix, k.expires_at ${join} ORDER BY u.username, k.name, k.key_id`).all();
    return keys.filter(key => active(key.expires_at)).map(({ expires_at: _expires, ...key }) => key as ConnectionKey);
  } finally {
    database.close();
  }
}

const script = `try {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const result = await (${queryConnectionKeys.toString()})('/data/metadata/tdai_metadata_ams/metadata.db', JSON.parse(input));
  process.stdout.write(JSON.stringify(result));
} catch { process.exitCode = 1; }`;

async function lookup(directory: string, provider: Provider, request: KeyRequest, run: Runner): Promise<unknown> {
  directory = resolve(directory);
  if (!['docker', 'podman', 'podman-compose', 'uvx-podman-compose'].includes(provider)) throw new DeploymentError('Select a supported container engine to read connection details.');
  const command = provider === 'docker' ? 'docker' : 'podman';
  const project = `ams-${createHash('sha256').update(directory).digest('hex').slice(0, 10)}`;
  try {
    const id = (await run({ command, args: ['ps', '-q', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`,
      '--filter', 'label=com.docker.compose.service=core'], cwd: directory, timeoutMs: 10_000 })).trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error();
    const containers = JSON.parse(await run({ command, args: ['inspect', id], cwd: directory, timeoutMs: 10_000 }));
    if (!Array.isArray(containers) || containers.length !== 1) throw new Error();
    const container = containers[0];
    if (container?.Id !== id || container.State?.Running !== true
      || container.Config?.Labels?.['com.docker.compose.project'] !== project
      || container.Config?.Labels?.['com.docker.compose.service'] !== 'core') throw new Error();
    return JSON.parse(await run({ command, args: ['exec', '-i', id, 'node', '--input-type=module', '--eval', script],
      cwd: directory, input: JSON.stringify(request), timeoutMs: 10_000, label: 'Read connection key' }));
  } catch {
    throw new DeploymentError('Cannot read connection keys. Check that this installation’s Core is running and its metadata database is available.');
  }
}

export async function listConnectionKeys(directory: string, provider: Provider, run: Runner = runProcess): Promise<ConnectionKey[]> {
  const keys = await lookup(directory, provider, { operation: 'list' }, run);
  const fields = ['userId', 'username', 'userType', 'keyId', 'name', 'suffix'] as const;
  if (!Array.isArray(keys) || keys.some(key => !key || fields.some(field => typeof key[field] !== 'string' || /[\x00-\x1f\x7f]/.test(key[field]))
    || !key.userId || !key.keyId || key.suffix.length > 4)) throw new DeploymentError('Core returned invalid connection key metadata.');
  return keys.map(key => Object.fromEntries(fields.map(field => [field, key[field]])) as ConnectionKey);
}

export async function readConnectionKey(directory: string, provider: Provider, keyId: string, run: Runner = runProcess): Promise<string> {
  if (typeof keyId !== 'string' || !keyId || /[\x00-\x1f\x7f]/.test(keyId)) throw new DeploymentError('Select an existing connection key.');
  const key = await lookup(directory, provider, { operation: 'read', keyId }, run);
  if (typeof key !== 'string' || !key || key !== key.trim() || /[\x00-\x1f\x7f]/.test(key)) throw new DeploymentError('The selected connection key is unavailable or no longer active. Refresh connection details.');
  return key;
}
