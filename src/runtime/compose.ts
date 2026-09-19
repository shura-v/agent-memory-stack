import { DeploymentError } from "./errors.js";
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { accountProviders } from '../config/providers.js';
import type { AccountProvider } from '../config/providers.js';
import { setTimeout } from 'node:timers/promises';
import { validateDeploymentImages } from '../build/images.js';
import type { ImageManifest, ImagePlatform, ImageService } from '../build/images.js';
import { atomicWrite } from '../config/files.js';
import { resolveSettings } from '../config/settings.js';
import { readInstallationEnv } from '../config/native-state.js';
import { resolveDeployment } from '../deployment/model.js';
import { ProcessFailure, runProcess } from './process.js';
import type { Runner } from './process.js';
import { listConnectionKeys, readConnectionKey } from './connection-keys.js';
import { reservePublishedPorts } from './ports.js';
import type { PortReservation } from './ports.js';

export type Provider = 'docker' | 'podman' | 'podman-compose' | 'uvx-podman-compose';
export type ReadinessResult = { pending: string[] };
export interface DeploymentRuntime {
  checkProvider?(): Promise<void>;
  snapshot?(manifest: ImageManifest): Promise<void>;
  reservePorts?(manifest: ImageManifest, settings: Record<string, string>): Promise<PortReservation>;
  preflight(manifest: ImageManifest, settings?: Record<string, string>): Promise<ReadinessResult | void>;
  apply(adminKey?: string, options?: { createAdminKey?: () => Promise<string> }): Promise<ReadinessResult | void>;
  hasProviderAuthorization?(provider: AccountProvider): Promise<boolean>;
  login(provider: AccountProvider): Promise<void>;
  status(): Promise<string>;
}
export type AppliedInventory = { version: 1; services: string[]; coreInitialized?: boolean };
const managedNames = ['core', 'knowledge', 'panel', 'memory-proxy', 'cli-proxy-api', 'mcp', 'config', 'bootstrap', 'access'];
export async function readAppliedInventory(directory: string): Promise<AppliedInventory | undefined> {
  try {
    const data = JSON.parse(await readFile(join(directory, '.ams/applied.json'), 'utf8')) as AppliedInventory;
    if (data.version !== 1 || !Array.isArray(data.services) || data.services.some(name => !managedNames.includes(name))
      || (data.coreInitialized !== undefined && typeof data.coreInitialized !== 'boolean')) throw new DeploymentError();
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DeploymentError('Invalid applied service inventory; repair .ams/applied.json before applying');
  }
}

export function runtimeFor(directory: string, provider: Provider, run: Runner = runProcess): DeploymentRuntime {
  const engine = provider === 'docker' ? 'docker' : 'podman';
  const command = provider === 'uvx-podman-compose' ? 'uvx' : provider;
  const prefix = provider === 'uvx-podman-compose' ? ['podman-compose'] : ['docker', 'podman'].includes(provider) ? ['compose'] : [];
  const project = `ams-${createHash('sha256').update(directory).digest('hex').slice(0, 10)}`;
  const processEnv = { ...process.env };
  for (const name of Object.keys(processEnv)) if (/_IMAGE$|_PORT$/.test(name) || name === 'DATA_DIR' || name.startsWith('COMPOSE_')) delete processEnv[name];
  let providerChecked = false;
  async function checkProvider(): Promise<void> {
    if (providerChecked) return;
    try {
      await run({ command, args: [...prefix, 'version'], cwd: directory, env: processEnv });
      providerChecked = true;
    } catch {
      const instructions: Record<Provider, string> = {
        docker: 'Install or repair the Docker Compose plugin.',
        podman: 'Install and configure a Compose provider for Podman (podman-compose or docker-compose).',
        'podman-compose': 'Install podman-compose and make it available on PATH.',
        'uvx-podman-compose': 'Install uv, make uvx available on PATH, and ensure it can run podman-compose.',
      };
      throw new DeploymentError(`Cannot run ${[command, ...prefix, 'version'].join(' ')}. ${instructions[provider] ?? "Check the configured Compose command."} Verify this command succeeds, then retry ams apply.`);
    }
  }
  const compose = (args: string[], input?: string, interactive = false) => run({ command, args: [...prefix,
    '--project-name', project, '--env-file', join(directory, '.ams/compose.env'), '-f', join(directory, 'compose.yaml'), ...args], cwd: directory, input, interactive, env: processEnv,
    label: `Compose ${args[0]} (${args.filter(name => managedNames.includes(name)).join(', ') || 'project'})${args.includes('initialize') ? ' administrator initialization' : ''}`,
    classifyPortConflict: args[0] === 'up',
    safeErrorPrefix: args[0] === 'run' && args.includes('bootstrap') ? 'Bootstrap failed: ' : undefined });
  const readPlan = async () => resolveDeployment(resolveSettings(await readInstallationEnv(directory)));
  async function waitFor(service: string, condition: 'healthy' | 'completed' | 'running'): Promise<void> {
    const id = (await run({ command: engine, args: ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`,
      '--filter', `label=com.docker.compose.service=${service}`] })).trim();
    if (!id || id.includes('\n')) throw new DeploymentError(`Cannot identify the single ${service} container in this Compose project`);
    for (let attempt = 0; attempt < 90; attempt++) {
      const [container] = JSON.parse(await run({ command: engine, args: ['inspect', id] }));
      const state = container.State;
      if (condition === 'running' && state?.Status === 'running') return;
      if (condition === 'healthy' && (state?.Health?.Status === 'healthy' || state?.Healthcheck?.Status === 'healthy')) return;
      if (state?.Status === 'exited' || state?.Status === 'stopped') {
        if (condition === 'completed' && state.ExitCode === 0) return;
        throw new DeploymentError(`${service} exited before readiness; inspect its local logs`);
      }
      await setTimeout(1000);
    }
    throw new DeploymentError(`${service} readiness timed out after 90 seconds`);
  }
  async function ownedContainers(): Promise<{ id: string; service: string }[]> {
    const ids = (await run({ command: engine, args: ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`] })).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return [];
    const containers = JSON.parse(await run({ command: engine, args: ['inspect', ...ids] })) as Array<{ Id: string; Config?: { Labels?: Record<string, string> } }>;
    return containers.flatMap(container => {
      const labels = container.Config?.Labels;
      const service = labels?.['com.docker.compose.service'];
      return labels?.['com.docker.compose.project'] === project && service && managedNames.includes(service) ? [{ id: container.Id, service }] : [];
    });
  }
  return {
    checkProvider,
    async reservePorts(manifest, settings) {
      await checkProvider();
      return reservePublishedPorts(engine, project, manifest, resolveDeployment(settings).interfaces, run);
    },
    async snapshot(manifest) {
      validateDeploymentImages(manifest);
      await run({ command: engine, args: ['run', '--rm', '--network', 'none', '--user', '0:0', '-v', `${directory}:/state`, manifest.images.runtime!.id, '/app/runtime/snapshot.js', '/state'], label: 'Preserve previous installation settings' });
    },
    async preflight(manifest, settings) {
      const plan = settings ? resolveDeployment(settings) : await readPlan();
      validateDeploymentImages(manifest);
      await checkProvider();
      const info = JSON.parse(await run({ command: engine, args: ['info', '--format', '{{json .}}'] }));
      const architecture = info.host?.arch ?? info.Host?.Arch ?? info.Architecture;
      const arch = ({ aarch64: 'arm64', x86_64: 'amd64' } as Record<string, string>)[architecture] ?? architecture;
      const platform = `linux/${arch}` as ImagePlatform;
      validateDeploymentImages(manifest, platform);
      for (const service of plan.requiredImages as ImageService[]) {
        const identity = manifest.images[service]!;
        const [actual] = JSON.parse(await run({ command: engine, args: ['image', 'inspect', identity.id] }));
        if (`sha256:${String(actual.Id).replace(/^sha256:/, '')}` !== identity.id
          || `${actual.Os}/${actual.Architecture}` !== platform) throw new DeploymentError(`Image identity/platform mismatch: ${service}`);
      }
      return { pending: [] };
    },
    async apply(adminKey, options = {}) {
      const plan = await readPlan();
      const applied = await readAppliedInventory(directory);
      await compose(['config']);
      const owned = await ownedContainers();
      if (owned.length) await run({ command: engine, args: ['stop', ...owned.map(item => item.id)], label: 'Stop this installation before applying configuration' });
      await compose(['run', '--rm', '--no-deps', 'config']);
      const ready = new Set(['config']);
      if (plan.readiness.some(edge => ['core', 'knowledge'].includes(edge.service) && edge.dependsOn.includes('cli-proxy-api'))) {
        await compose(['up', '-d', '--no-deps', '--force-recreate', 'cli-proxy-api']);
        await waitFor('cli-proxy-api', 'running');
        ready.add('cli-proxy-api');
      }
      await compose(['up', '-d', '--no-deps', '--force-recreate', 'core']);
      await waitFor('core', 'healthy');
      ready.add('core');
      if (adminKey === undefined && options.createAdminKey) {
        try {
          await compose(['run', '--rm', '-T', '--no-deps', 'bootstrap']);
        } catch (error) {
          if (!(error instanceof ProcessFailure) || error.exitCode !== 2) throw error;
          adminKey = await options.createAdminKey();
        }
        // An administrator can exist after initialization failed before its
        // default team or agent was created. Resume with the same stored key.
        if (adminKey === undefined && (!applied || applied.coreInitialized === false)) {
          const key = (await listConnectionKeys(directory, provider, run)).find(item => item.userType === 'system_admin');
          if (!key) throw new DeploymentError('Cannot finish administrator initialization: no active administrator key is available. Restore administrator access before applying.');
          adminKey = await readConnectionKey(directory, provider, key.keyId, run);
        }
      }
      if (adminKey !== undefined) {
        // Old inventory may outlive a replaced database. Keep its service
        // ownership records, but do not mistake an interrupted reinit for success.
        if (applied) await atomicWrite(join(directory, '.ams/applied.json'), JSON.stringify({ ...applied, coreInitialized: false }, null, 2) + '\n');
        await compose(['run', '--rm', '-T', '--no-deps', 'bootstrap', '--import', '/app/runtime/environment.js', '/app/runtime/bootstrap.js', 'initialize'], JSON.stringify({ adminKey }));
      }
      await compose(['up', '-d', '--no-deps', '--force-recreate', 'bootstrap']);
      await waitFor('bootstrap', 'completed');
      ready.add('bootstrap');
      let remaining = plan.containers.filter(name => !ready.has(name));
      while (remaining.length) {
        const next = remaining.filter(name => (plan.readiness.find(edge => edge.service === name)?.dependsOn ?? (name === 'access' ? ['knowledge'] : [])).every(dependency => ready.has(dependency)));
        if (!next.length) throw new DeploymentError('Local readiness dependencies contain a cycle');
        await compose(['up', '-d', '--no-deps', '--force-recreate', ...next]);
        for (const service of next) { await waitFor(service, service === 'cli-proxy-api' ? 'running' : 'healthy'); ready.add(service); }
        remaining = remaining.filter(name => !ready.has(name));
      }
      await mkdir(join(directory, '.ams'), { recursive: true });
      await atomicWrite(join(directory, '.ams/applied.json'), JSON.stringify({ version: 1, services: plan.containers }, null, 2) + '\n');
      const result = { pending: [] };
      await atomicWrite(join(directory, '.ams/readiness.json'), JSON.stringify(result, null, 2) + '\n');
      await rm(join(directory, '.ams/apply-pending'), { force: true });
      return result;
    },
    async hasProviderAuthorization(provider) {
      const settings = resolveSettings(await readInstallationEnv(directory));
      const manifest = await loadManifest(join(directory, '.ams/images.json'));
      const authDirectory = resolve(directory, settings.DATA_DIR, 'cli-proxy-api/auth');
      const output = await run({ command: engine, args: ['run', '--rm', '--network', 'none',
        '-v', `${authDirectory}:/auth:ro`, manifest.images.runtime!.id,
        '/app/runtime/provider-auth.js', '/auth', provider], label: 'Check saved provider authorization', timeoutMs: 15_000 });
      if (!['true', 'false'].includes(output.trim())) throw new DeploymentError('Invalid provider authorization check result');
      return output.trim() === 'true';
    },
    async login(provider) {
      resolveSettings(await readInstallationEnv(directory));
      await compose(['stop', 'cli-proxy-api'], undefined, false);
      try { await compose(['run', '--rm', '--no-deps', 'cli-proxy-api', '-config', '/config/cli-proxy-api.yaml', accountProviders[provider].loginFlag, '-no-browser'], undefined, true); }
      finally { await compose(['up', '-d', '--no-deps', 'cli-proxy-api'], undefined, false); }
    },
    status: () => compose(['ps']),
  };
}
export async function loadManifest(path: string): Promise<ImageManifest> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new DeploymentError('Cannot read installation image records; rerun ams to prepare images'); }
  return validateDeploymentImages(parsed);
}
