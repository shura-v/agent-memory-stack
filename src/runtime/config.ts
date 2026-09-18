import { chmod, chown, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, atomicWrite } from '../config/files.js';
import { validateEnv } from '../config/settings.js';
import { serviceConfigs } from '../config/services.js';
import { resolveDeployment } from '../deployment/model.js';

export { validateEnv, serviceConfigs, atomicWrite };
export async function generate(directory: string, { dataRoot, uid }: { dataRoot?: string; uid?: number } = {}) {
  const env = validateEnv(await readEnv(join(directory, '.env')));
  const generated = join(directory, 'generated');
  await mkdir(generated, { recursive: true, mode: 0o700 });
  await chmod(generated, 0o700);
  if (uid !== undefined && process.getuid?.() === 0) await chown(generated, uid, uid);
  const configs = serviceConfigs(env);
  for (const name of ['core.yaml', 'core-env.json', 'bootstrap-env.json', 'knowledge-env.json', 'access-env.json', 'knowledge-service.json', 'panel-env.json', 'panel-instances.json', 'proxy.yaml', 'proxy-env.json', 'cli-proxy-api.yaml', 'mcp.json']) {
    if (!(name in configs)) await rm(join(generated, name), { force: true });
  }
  for (const [name, value] of Object.entries(configs)) {
    await atomicWrite(join(generated, name), JSON.stringify(value, null, 2) + '\n', uid);
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
    if (action === 'check') validateEnv(await readEnv(join(directory, '.env')));
    else if (action === 'generate') await generate(directory, {
      dataRoot: process.env.AMS_DATA_ROOT,
      uid: process.env.AMS_SERVICE_UID ? Number(process.env.AMS_SERVICE_UID) : undefined,
    });
    else throw new Error('Use check or generate');
    console.log('Configuration is valid.');
  } catch {
    console.error('Configuration failed; check .env fields and file permissions.');
    process.exitCode = 1;
  }
}
