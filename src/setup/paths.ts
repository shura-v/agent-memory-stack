import { homedir } from 'node:os';
import { join, sep } from 'node:path';

/** Shorten only the current user's home directory at the start of a path. */
export function displayHomePath(path: string): string {
  const home = homedir();
  if (path === home) return '~';
  return path.startsWith(home + sep) ? '~' + path.slice(home.length) : path;
}

/** Expand home shorthand while preserving installation-relative paths. */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}
