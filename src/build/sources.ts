import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeploymentError } from '../runtime/errors.js';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const buildContext = (projectDir: string): string => resolve(projectDir, '.ams-build');

export interface SourceLock { revision: string; url: string; sha256: string }
interface UpstreamLock {
  sources: Record<string, SourceLock>;
  images: Record<string, string>;
  [key: string]: unknown;
}

/** Validate portable source metadata without trusting extra archive fields. */
export function validateTdaiSource(value: unknown): SourceLock {
  const source = value as SourceLock;
  if (!source || typeof source.revision !== 'string' || typeof source.sha256 !== 'string'
    || !/^[a-f0-9]{40}$/.test(source.revision) || !/^[a-f0-9]{64}$/.test(source.sha256)
    || source.url !== `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${source.revision}`) {
    throw new DeploymentError('Invalid TDAI source selection');
  }
  return { revision: source.revision, url: source.url, sha256: source.sha256 };
}

/** Installation updates override only Tencent sources, never packaged build inputs. */
export async function loadSourceLock(projectDir?: string, root = packageRoot): Promise<UpstreamLock> {
  const lock = JSON.parse(await readFile(resolve(root, 'upstream.lock.json'), 'utf8')) as UpstreamLock;
  if (!projectDir) return lock;
  let raw: string;
  try { raw = await readFile(resolve(projectDir, '.ams/tdai-source.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return lock; throw error; }
  let source: SourceLock;
  try {
    source = validateTdaiSource(JSON.parse(raw));
  } catch { throw new DeploymentError('Invalid .ams/tdai-source.json; restore the saved TDAI source selection before applying'); }
  lock.sources.tencent = { ...lock.sources.tencent, revision: source.revision, url: source.url, sha256: source.sha256 };
  return lock;
}

export function verifyArchive(bytes: Uint8Array, expectedHash: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw new Error(`${name}: archive SHA-256 mismatch; remove the cached archive and retry`);
  }
}

function sourceArchivePath(projectDir: string, name: string, source: SourceLock): string {
  if (!/^[a-z]+$/.test(name) || !/^[a-f0-9]{40}$/.test(source.revision)) throw new Error(`Invalid source lock entry: ${name}`);
  return resolve(buildContext(projectDir), '.cache/upstream', `${name}-${source.revision}.tar.gz`);
}

/** Verify before atomically adding an archive to the installation's download cache. */
export async function cacheSourceArchive(projectDir: string, name: string, source: SourceLock, bytes: Uint8Array): Promise<string> {
  const archive = sourceArchivePath(projectDir, name, source);
  verifyArchive(bytes, source.sha256, name);
  await mkdir(dirname(archive), { recursive: true });
  const temporary = `${archive}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, archive);
  } finally { await rm(temporary, { force: true }); }
  return archive;
}

/** A corrupt cached archive is an error; only an absent archive is downloaded. */
export async function acquireSourceArchive(projectDir: string, name: string, source: SourceLock,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<string> {
  const archive = sourceArchivePath(projectDir, name, source);
  let bytes: Buffer;
  try { bytes = await readFile(archive); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.log(`Downloading ${name} ${source.revision}`);
    const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`${name} download: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    return cacheSourceArchive(projectDir, name, source, bytes);
  }
  verifyArchive(bytes, source.sha256, name);
  return archive;
}

/** The installed package supplies immutable inputs; all writes go to projectDir. */
export async function fetchSources(projectDir = process.cwd(), root = packageRoot): Promise<string> {
  const lock = await loadSourceLock(projectDir, root);
  const cache = resolve(buildContext(projectDir), '.cache/upstream');
  for (const [name, source] of Object.entries(lock.sources)) {
    const archive = await acquireSourceArchive(projectDir, name, source);
    const temporary = resolve(cache, `${name}-${randomUUID()}`);
    await mkdir(temporary);
    try {
      execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', temporary], { stdio: 'inherit' });
      // Replace prepared trees with the verified archive, including its original dependency metadata.
      await rm(resolve(cache, name), { recursive: true, force: true });
      await rename(temporary, resolve(cache, name));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    console.log(`${name}: verified ${source.revision}`);
  }
  return cache;
}
