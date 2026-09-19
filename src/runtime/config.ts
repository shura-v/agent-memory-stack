import { chmod, chown, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../config/files.js';
import { resolveSettings } from '../config/settings.js';
import { resolveDeployment } from '../deployment/model.js';

export { resolveSettings, atomicWrite };
export async function generate(directory: string, { dataRoot, uid }: { dataRoot?: string; uid?: number } = {}) {
  let input: { generation: string; env: Record<string, string>; documents: Record<string, string>; runtimeConfigs: Record<string, unknown> } | undefined;
  try { input = JSON.parse(await readFile(join(directory, '.ams/native-runtime.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!input) {
    throw new Error('TDAI native configuration is not staged; run ams apply before starting services');
  }
  if (!/^[a-f0-9-]{36}$/.test(input.generation)) throw new Error('Invalid native configuration generation');
  const env = resolveSettings(input.env);
  const generated = join(directory, '.ams/generations', input.generation);
  await mkdir(generated, { recursive: true, mode: 0o700 });
  await chmod(generated, 0o700);
  if (uid !== undefined && process.getuid?.() === 0) await chown(generated, uid, uid);
  const configs = { ...input.runtimeConfigs, ...input.documents };
  if (Object.keys(configs).some(name => !/^[a-z][a-z-]*\.(?:json|yaml|env)$/.test(name))) throw new Error('Invalid configuration filename');
  for (const [name, value] of Object.entries(configs)) {
    await atomicWrite(join(generated, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', uid);
  }
  const storage = dataRoot ?? resolve(directory, env.DATA_DIR);
  for (const name of resolveDeployment(env).dataDirectories) {
    const path = join(storage, name);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    if (uid !== undefined && process.getuid?.() === 0) await chown(path, uid, uid);
  }
  return { generated, env };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2] ?? 'check';
    const directory = resolve(process.argv[3] ?? 'server');
    if (action === 'check') {
      await readFile(join(directory, '.env'), 'utf8');
      const { readInstallationEnv } = await import('../config/native-state.js');
      await readInstallationEnv(directory);
    }
    else if (action === 'generate') await generate(directory, {
      dataRoot: process.env.AMS_DATA_ROOT,
      uid: process.env.AMS_SERVICE_UID ? Number(process.env.AMS_SERVICE_UID) : undefined,
    });
    else throw new Error('Use check or generate');
    console.log(action === 'check' ? 'Configuration files loaded successfully.' : 'Configuration files generated.');
  } catch {
    console.error('Cannot read or compose configuration files; check file syntax, recorded paths and permissions.');
    process.exitCode = 1;
  }
}
