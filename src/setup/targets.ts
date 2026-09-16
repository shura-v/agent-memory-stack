import { lstat, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { atomicWrite } from '../config/files.js';
import { DeploymentError } from '../runtime/errors.js';

export type Target = 'server';
export interface TargetStore {
  recall(target: Target): Promise<string | undefined>;
  remember(target: Target, path: string): Promise<void>;
}
type SavedTargets = { version: 1; server?: string };

export function createTargetStore(path = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'agent-memory-stack', 'targets.json')): TargetStore {
  const read = async (): Promise<SavedTargets> => {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid file');
      const data = JSON.parse(await readFile(path, 'utf8')) as SavedTargets;
      if (!data || data.version !== 1 || Object.keys(data).some(key => !['version', 'server', 'client'].includes(key))
        || (data.server !== undefined && (typeof data.server !== 'string' || !isAbsolute(data.server) || data.server.includes('\0')))) throw new Error('Invalid targets');
      return { version: 1, ...(data.server === undefined ? {} : { server: data.server }) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 };
      throw new DeploymentError(`Cannot read saved setup locations at ${path}. Restore or repair this file before running setup.`);
    }
  };
  return {
    async recall(target) { return (await read())[target]; },
    async remember(target, location) {
      if (!isAbsolute(location) || location.includes('\0')) throw new DeploymentError('Setup location must be an absolute path');
      const data = await read();
      data[target] = location;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await atomicWrite(path, JSON.stringify(data, null, 2) + '\n');
    },
  };
}

export const targetStore = createTargetStore();
