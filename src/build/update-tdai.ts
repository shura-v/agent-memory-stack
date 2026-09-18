import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, readEnv } from '../config/files.js';
import { validateEnv } from '../config/settings.js';
import { selectionFromEnv } from '../deployment/model.js';
import { DeploymentError } from '../runtime/errors.js';
import { preserveInputs } from '../setup/server-settings.js';
import { buildContext, loadSourceLock, type SourceLock } from './sources.js';

/** Download the branch tip and pin it for this installation's next apply. */
export async function updateTdai(directory: string, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<{ previousRevision: string; revision: string }> {
  const env = validateEnv(await readEnv(join(directory, '.env')));
  if (!selectionFromEnv(env).some(service => ['core', 'knowledge', 'panel', 'memory-proxy'].includes(service))) {
    throw new DeploymentError('This installation has no TDAI services to update');
  }
  const previousRevision = (await loadSourceLock(directory)).sources.tencent.revision;
  let source: SourceLock;
  let bytes: Buffer;
  try {
    const response = await fetchImpl('https://api.github.com/repos/TencentCloud/TencentDB-Agent-Memory/commits/feat%2Fserver_team', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-memory-stack' }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const commit = await response.json() as { sha?: unknown };
    if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error();
    const url = `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${commit.sha}`;
    const archive = await fetchImpl(url, { signal: AbortSignal.timeout(300_000) });
    if (!archive.ok) throw new Error();
    bytes = Buffer.from(await archive.arrayBuffer());
    source = { revision: commit.sha, url, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    throw new DeploymentError('Could not download TDAI from feat/server_team; the saved source selection was not changed. Check access to GitHub and retry');
  }
  const cache = join(buildContext(directory), '.cache/upstream');
  await mkdir(cache, { recursive: true });
  const archive = join(cache, `tencent-${source.revision}.tar.gz`);
  const temporary = `${archive}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, archive);
  } finally { await rm(temporary, { force: true }); }
  await preserveInputs(directory);
  await atomicWrite(join(directory, '.ams/tdai-source.json'), JSON.stringify(source, null, 2) + '\n');
  return { previousRevision, revision: source.revision };
}
