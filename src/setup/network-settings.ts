import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, readEnv } from '../config/files.js';

const originPorts = {
  MEMORY_PROXY_PUBLIC_URL: 'MEMORY_PROXY_PORT',
  PANEL_PUBLIC_URL: 'PANEL_PORT',
  KNOWLEDGE_PUBLIC_URL: 'KNOWLEDGE_PORT',
} as const;

/** Persist allocated ports; explicit native origins are owned by overrides. */
export async function saveResolvedNetwork(directory: string, env: Record<string, string>, ports: Record<string, string>, options: { initializeOrigins?: boolean } = {}): Promise<Record<string, string>> {
  const path = join(directory, '.env');
  const saved = await readEnv(path);
  const resolved = { ...env, ...ports };
  if (options.initializeOrigins) for (const [field, portField] of Object.entries(originPorts)) {
    const current = env[field];
    if (!current || [`http://127.0.0.1:${env[portField]}`, `http://localhost:${env[portField]}`].includes(current)) {
      const hostname = current ? new URL(current).hostname : '127.0.0.1';
      resolved[field] = `http://${hostname}:${resolved[portField]}`;
    }
  }
  const changes = Object.fromEntries(Object.keys(ports)
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
  return resolved;
}
