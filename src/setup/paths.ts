import { homedir } from 'node:os';
import { join, sep } from 'node:path';

/** Shorten only the current user's home directory at the start of a path. */
export function displayHomePath(path: string): string {
  const home = homedir();
  if (path === home) return '~';
  return path.startsWith(home + sep) ? '~' + path.slice(home.length) : path;
}

/** One configuration root per OS user, independent of the current directory. */
export function configurationDirectory(): string {
  return join(homedir(), '.agent-memory-stack');
}
