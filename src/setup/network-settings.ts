import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, readEnv } from '../config/files.js';
import { DeploymentError } from '../runtime/errors.js';

const originPorts = {
  MEMORY_PROXY_PUBLIC_URL: 'MEMORY_PROXY_PORT',
  PANEL_PUBLIC_URL: 'PANEL_PORT',
  KNOWLEDGE_PUBLIC_URL: 'KNOWLEDGE_PORT',
} as const;
type Provenance = { version: 1; generatedOrigins: Record<string, string> };

async function readProvenance(directory: string): Promise<Provenance | undefined> {
  try {
    const value = JSON.parse(await readFile(join(directory, '.ams/network.json'), 'utf8'));
    if (value?.version !== 1 || !value.generatedOrigins || typeof value.generatedOrigins !== 'object'
      || Array.isArray(value.generatedOrigins) || Object.entries(value.generatedOrigins).some(([key, origin]) =>
        !Object.hasOwn(originPorts, key) || typeof origin !== 'string' || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) throw new Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DeploymentError('Cannot read .ams/network.json. Restore its saved copy before applying network changes.');
  }
}

/** Change only allocated fields; preserve comments and all other operator input bytes. */
export async function saveResolvedNetwork(directory: string, env: Record<string, string>, ports: Record<string, string>): Promise<Record<string, string>> {
  const previous = await readProvenance(directory);
  const path = join(directory, '.env');
  const saved = await readEnv(path);
  const resolved = { ...env, ...ports };
  const generatedOrigins: Record<string, string> = {};
  for (const [field, portField] of Object.entries(originPorts)) {
    const oldOrigin = env[field];
    const generated = !Object.hasOwn(saved, field) || (previous
      ? previous.generatedOrigins[field] === oldOrigin
      : [`http://127.0.0.1:${env[portField]}`, `http://localhost:${env[portField]}`].includes(oldOrigin));
    if (!generated) continue;
    const hostname = new URL(oldOrigin).hostname;
    resolved[field] = `http://${hostname}:${resolved[portField]}`;
    generatedOrigins[field] = resolved[field];
  }
  const changes = Object.fromEntries([...Object.keys(ports), ...Object.keys(generatedOrigins)]
    .filter(key => saved[key] !== resolved[key]).map(key => [key, resolved[key]]));
  if (Object.keys(changes).length) {
    const source = await readFile(path, 'utf8');
    const seen = new Set<string>();
    let updated = source.replace(/^([A-Z][A-Z0-9_]*)=.*$/gm, (line, key: string) => {
      if (!Object.hasOwn(changes, key)) return line;
      seen.add(key);
      return `${key}=${JSON.stringify(changes[key])}`;
    });
    for (const [key, value] of Object.entries(changes)) if (!seen.has(key)) {
      if (updated && !updated.endsWith('\n')) updated += '\n';
      updated += `${key}=${JSON.stringify(value)}\n`;
    }
    await atomicWrite(path, updated);
  }
  await atomicWrite(join(directory, '.ams/network.json'), JSON.stringify({ version: 1, generatedOrigins } satisfies Provenance, null, 2) + '\n');
  return resolved;
}
