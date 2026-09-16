import { randomBytes } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Double-quoted values use JSON escaping. Compose receives a separate,
// secret-free env file: it never interprets this editable settings file.
export function decodeEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('Invalid .env line; use NAME=value or NAME="JSON-escaped value"');
    const [, key, raw] = match;
    try { result[key] = raw.startsWith('"') ? JSON.parse(raw) as string : (parseEnv(line)[key] ?? ''); }
    catch { throw new Error(`Invalid .env quoting for ${key}`); }
    if (typeof result[key] !== 'string') throw new Error(`Invalid .env value for ${key}`);
  }
  return result;
}
export function encodeEnv(env: Record<string, string>): string {
  return '# Managed by ams. Double-quoted values use JSON escaping; $ stays literal.\n'
    + Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
}
export async function readEnv(path: string): Promise<Record<string, string>> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('.env must be a regular file');
    return decodeEnv(await readFile(path, 'utf8'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
}
export async function atomicWrite(path: string, content: string, uid?: number): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    if (uid !== undefined && process.getuid?.() === 0) await handle.chown(uid, uid);
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
