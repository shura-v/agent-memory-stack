import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const buildContext = (projectDir: string): string => resolve(projectDir, '.ams-build');

interface SourceLock { revision: string; url: string; sha256: string }

export function verifyArchive(bytes: Uint8Array, expectedHash: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw new Error(`${name}: archive SHA-256 mismatch; remove the cached archive and retry`);
  }
}

/** The installed package supplies immutable inputs; all writes go to projectDir. */
export async function fetchSources(projectDir = process.cwd()): Promise<string> {
  const lock = JSON.parse(await readFile(resolve(packageRoot, 'upstream.lock.json'), 'utf8')) as { sources: Record<string, SourceLock> };
  const cache = resolve(buildContext(projectDir), '.cache/upstream');
  await mkdir(cache, { recursive: true });
  for (const [name, source] of Object.entries(lock.sources)) {
    if (!/^[a-z]+$/.test(name) || !/^[a-f0-9]{40}$/.test(source.revision)) throw new Error(`Invalid source lock entry: ${name}`);
    const archive = resolve(cache, `${name}-${source.revision}.tar.gz`);
    let bytes: Buffer;
    try { bytes = await readFile(archive); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      console.log(`Downloading ${name} ${source.revision}`);
      const response = await fetch(source.url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`${name} download: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    verifyArchive(bytes, source.sha256, name);
    await writeFile(archive, bytes);
    const temporary = resolve(cache, `${name}-${randomUUID()}`);
    await mkdir(temporary);
    try {
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', temporary], { stdio: 'inherit' });
      // Always restore clean sources: changing a patch can never reuse an old patched tree.
      await rm(resolve(cache, name), { recursive: true, force: true });
      await rename(temporary, resolve(cache, name));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    console.log(`${name}: verified ${source.revision}`);
  }
  execFileSync(process.execPath, [resolve(packageRoot, 'dist/patches/apply.js'), resolve(cache, 'tencent')], { stdio: 'inherit' });
  return cache;
}
