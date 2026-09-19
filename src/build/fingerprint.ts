import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ImageService } from './images.js';
import { loadSourceLock, packageRoot } from './sources.js';

export const buildFingerprintLabel = 'io.agent-memory-stack.build-fingerprint';
export const contextPackageJson = '{"type":"module"}\n';

/** Hash packaged inputs and the effective TDAI source, never secrets or paths. */
export async function buildFingerprint(service: ImageService, root = packageRoot, projectDir?: string): Promise<string> {
  let inputs: string[];
  if (service === 'runtime') {
    inputs = ['deploy/runtime.Dockerfile', 'dist/runtime', 'dist/config', 'dist/deployment'];
  } else if (service === 'mcp') {
    inputs = ['deploy/node.Dockerfile', 'deploy/debian.sources', 'deploy/locks/mcp',
      'upstream.lock.json', 'dist/build/sources.js',
      'dist/runtime', 'dist/config', 'dist/deployment'];
  } else if (service === 'cli-proxy-api') {
    inputs = ['deploy/cli-proxy-api.Dockerfile', 'deploy/debian.sources', 'upstream.lock.json'];
  } else {
    inputs = ['deploy/node.Dockerfile', 'deploy/debian.sources',
      'upstream.lock.json', 'dist/build/sources.js'];
  }
  const hash = createHash('sha256').update(`ams-build-inputs-v1\0${service}\0`);
  const add = (name: string, bytes: Uint8Array) => hash.update(JSON.stringify([name, bytes.length])).update(bytes);
  async function visit(relative: string): Promise<void> {
    // npm packages omit source maps; build contexts omit them too.
    if (relative.endsWith('.map')) return;
    const path = resolve(root, relative);
    const entry = await lstat(path);
    if (entry.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(`${relative}/${name}`);
    } else if (entry.isFile()) add(relative, await readFile(path));
    else throw new Error(`Build inputs must use regular files: ${relative}`);
  }
  for (const input of inputs.sort()) await visit(input);
  if (!['runtime', 'cli-proxy-api'].includes(service)) {
    const { revision, url, sha256 } = (await loadSourceLock(projectDir, root)).sources.tencent;
    add('effective-tencent-source', Buffer.from(JSON.stringify({ revision, url, sha256 })));
  }
  if (service === 'runtime') add('package.json', Buffer.from(contextPackageJson));
  return `sha256:${hash.digest('hex')}`;
}
