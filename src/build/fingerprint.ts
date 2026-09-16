import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ImageService } from './images.js';
import { packageRoot } from './sources.js';

export const buildFingerprintLabel = 'io.agent-memory-stack.build-fingerprint';
export const contextPackageJson = '{"type":"module"}\n';

/** Hash packaged build inputs, not installation files, clocks, or checkout paths. */
export async function buildFingerprint(service: ImageService, root = packageRoot): Promise<string> {
  let inputs: string[];
  if (service === 'runtime') {
    inputs = ['docker/runtime.Dockerfile', 'dist/runtime', 'dist/config', 'dist/deployment'];
  } else if (service === 'cli-proxy-api') {
    inputs = ['docker/cli-proxy-api.Dockerfile', 'docker/debian.sources', 'upstream.lock.json'];
  } else {
    const lock = service === 'memory-proxy' ? 'proxy' : service;
    inputs = ['docker/node.Dockerfile', 'docker/debian.sources', `docker/locks/${lock}`,
      'upstream.lock.json', 'dist/build/sources.js', 'dist/patches/apply.js',
      'patches/ams-access.ts', 'patches/ams-features.tsx',
      'dist/runtime/environment.js', 'dist/runtime/service-identity.js', 'dist/runtime/service-identity.d.ts'];
    if (service === 'panel') inputs.push('docker/locks/panel-web');
    if (service === 'knowledge' || service === 'memory-proxy') inputs.push('dist/build/native-smoke.js');
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
  if (service === 'runtime') add('package.json', Buffer.from(contextPackageJson));
  return `sha256:${hash.digest('hex')}`;
}
