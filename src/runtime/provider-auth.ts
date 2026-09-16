import { open, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountProvider } from '../config/providers.js';

const maxEntries = 10_000;
const maxFileBytes = 1024 * 1024;
const failureMessage = 'Cannot inspect saved CLIProxyAPI authorization.';

/** Checks saved credentials only; token refresh and account validity remain CLIProxyAPI's responsibility. */
export async function hasProviderAuthorization(directory: string, provider: AccountProvider): Promise<boolean> {
  try {
    const pending = [directory];
    let visited = 0;
    while (pending.length) {
      const current = pending.pop()!;
      let entries;
      try { entries = await opendir(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for await (const entry of entries) {
        if (++visited > maxEntries) throw new Error(failureMessage);
        const path = join(current, entry.name);
        if (entry.isDirectory()) { pending.push(path); continue; }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        let file;
        try { file = await open(path, 'r'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        let contents: Buffer;
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of file.createReadStream({ end: maxFileBytes, autoClose: false })) {
            chunks.push(chunk);
            size += chunk.length;
          }
          if (size > maxFileBytes) throw new Error(failureMessage);
          contents = Buffer.concat(chunks);
        } finally { await file.close(); }
        let auth: unknown;
        try { auth = JSON.parse(contents.toString('utf8')); } catch { continue; }
        if (!auth || typeof auth !== 'object' || Array.isArray(auth)) continue;
        const record = auth as Record<string, unknown>;
        if (typeof record.type !== 'string' || record.type.trim() !== provider || record.disabled === true) continue;
        const credentials = [record.access_token, record.refresh_token, ...(provider === 'claude' ? [record.refreshToken] : [])];
        if (credentials.some(value => typeof value === 'string' && value.trim().length > 0)) return true;
      }
    }
    return false;
  } catch {
    throw new Error(failureMessage);
  }
}

async function main(): Promise<void> {
  const [directory, provider, ...extra] = process.argv.slice(2);
  if (!directory || !['codex', 'claude'].includes(provider) || extra.length) throw new Error(failureMessage);
  process.stdout.write(`${JSON.stringify(await hasProviderAuthorization(directory, provider as AccountProvider))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(`${failureMessage}\n`);
    process.exitCode = 1;
  });
}
