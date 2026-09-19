import { DeploymentError } from "./errors.js";
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { accountProviders } from '../config/providers.js';
import type { AccountProvider } from '../config/providers.js';
import { setTimeout } from 'node:timers/promises';
import { validateDeploymentImages, validateImageManifest } from '../build/images.js';
import type { ImageManifest, ImagePlatform, ImageService } from '../build/images.js';
import { readEnv, atomicWrite, encodeEnv } from '../config/files.js';
import { validateEnv } from '../config/settings.js';
import { internalLLM } from '../config/internal-llm.js';
import { resolveDeployment } from '../deployment/model.js';
import type { Deployment } from '../deployment/model.js';
import { ProcessFailure, runProcess } from './process.js';
import type { Runner } from './process.js';
import { listConnectionKeys, readConnectionKey } from './connection-keys.js';
import type { ProbeConfig } from './integration.js';
import { reservePublishedPorts } from './ports.js';
import type { PortReservation } from './ports.js';
import { imageVariables, renderCompose } from './render-compose.js';
import { InternalModelAccessError } from './model-discovery.js';

export type Provider = 'docker' | 'podman' | 'podman-compose' | 'uvx-podman-compose';
export type ReadinessResult = { pending: string[] };
export interface DeploymentRuntime {
  checkProvider?(): Promise<void>;
  snapshot?(manifest: ImageManifest): Promise<void>;
  prepareInternalProxy?(manifest: ImageManifest, settings: Record<string, string>): Promise<void>;
  discoverInternalModels?(manifest: ImageManifest, settings: Record<string, string>): Promise<string[]>;
  reservePorts?(manifest: ImageManifest, settings: Record<string, string>): Promise<PortReservation>;
  preflight(manifest: ImageManifest, settings?: Record<string, string>): Promise<ReadinessResult | void>;
  apply(adminKey?: string, options?: { allowPending?: boolean; createAdminKey?: () => Promise<string> }): Promise<ReadinessResult | void>;
  hasProviderAuthorization?(provider: AccountProvider): Promise<boolean>;
  login(provider: AccountProvider): Promise<void>;
  status(): Promise<string>;
}
export type AppliedInventory = { version: 1; services: string[]; coreInitialized?: boolean };
const managedNames = ['core', 'knowledge', 'panel', 'memory-proxy', 'cli-proxy-api', 'mcp', 'config', 'bootstrap', 'access', 'knowledge-service'];
export async function readAppliedInventory(directory: string): Promise<AppliedInventory | undefined> {
  try {
    const data = JSON.parse(await readFile(join(directory, '.ams/applied.json'), 'utf8')) as AppliedInventory;
    if (data.version !== 1 || !Array.isArray(data.services) || data.services.some(name => !managedNames.includes(name))
      || (data.coreInitialized !== undefined && typeof data.coreInitialized !== 'boolean')) throw new DeploymentError();
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DeploymentError('Invalid applied service inventory; repair .ams/applied.json before changing services');
  }
}

/** Addresses are resolved for the actual consuming network, never the host process. */
export function integrationConfig(plan: Deployment, mode: 'preflight' | 'verify') {
  const checks: ProbeConfig['checks'] = [];
  for (const kind of ['core', 'model', 'knowledge', 'panel'] as const) {
    const connection = plan.connections[kind];
    if (connection.mode === 'disabled' || !connection.endpoint || !connection.key || (mode === 'preflight' && connection.mode !== 'remote')) continue;
    // A local model proxy may not have an account yet. Its /models check verifies
    // the service key; actual account/model authorization remains a separate step.
    checks.push({ name: kind, kind, url: connection.endpoint, key: connection.key, serviceId: 'ams' });
  }
  const { core, knowledge, panel, knowledgeTools } = plan.connections;
  if (knowledgeTools.endpoint && knowledgeTools.key && (mode === 'verify' || knowledgeTools.mode === 'remote')) {
    checks.push({ name: 'protected Knowledge tools', kind: 'knowledge-tools', url: knowledgeTools.endpoint, key: knowledgeTools.key, serviceId: 'ams' });
  }
  const toolsPairings = core.endpoint && core.key && knowledgeTools.endpoint
    && (mode === 'verify' || core.mode === 'remote' && knowledgeTools.mode === 'remote')
    ? [{ coreUrl: core.endpoint, knowledgeToolsUrl: knowledgeTools.endpoint, key: core.key }] : [];
  const pairing = core.endpoint && core.key && knowledge.endpoint && panel.endpoint
    && (mode === 'verify' || [core, knowledge, panel].every(item => item.mode === 'remote'));
  return { mode, checks, toolsPairings, pairings: pairing ? [{ coreUrl: core.endpoint!, knowledgeUrl: knowledge.endpoint!, panelUrl: panel.endpoint!, key: core.key! }] : [] };
}

export function runtimeFor(directory: string, provider: Provider, run: Runner = runProcess): DeploymentRuntime {
  if (!['docker', 'podman', 'podman-compose', 'uvx-podman-compose'].includes(provider)) throw new DeploymentError('Select a supported container engine / Compose provider');
  const engine = provider === 'docker' ? 'docker' : 'podman';
  const command = provider === 'uvx-podman-compose' ? 'uvx' : provider;
  const prefix = provider === 'uvx-podman-compose' ? ['podman-compose'] : ['docker', 'podman'].includes(provider) ? ['compose'] : [];
  const project = `ams-${createHash('sha256').update(directory).digest('hex').slice(0, 10)}`;
  const network = `${project}_stack`;
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
      throw new DeploymentError(`Cannot run ${[command, ...prefix, 'version'].join(' ')}. ${instructions[provider]} Verify this command succeeds, then retry ams apply.`);
    }
  }
  let proxyStage: string | undefined;
  const compose = (args: string[], input?: string, interactive = false, stage?: string) => run({ command, args: [...prefix,
    '--project-name', project, '--env-file', join(stage ?? directory, stage ? 'compose.env' : '.ams/compose.env'), '-f', join(stage ?? directory, 'compose.yaml'), ...args], cwd: directory, input, interactive, env: processEnv,
    label: `Compose ${args[0]} (${args.filter(name => managedNames.includes(name)).join(', ') || 'project'})${args.includes('initialize') ? ' administrator initialization' : ''}`,
    classifyPortConflict: args[0] === 'up',
    safeErrorPrefix: args[0] === 'run' && args.includes('bootstrap') ? 'Bootstrap failed: ' : undefined });
  const readPlan = async () => resolveDeployment(validateEnv(await readEnv(join(directory, '.env'))));
  async function probe(plan: Deployment, manifest: ImageManifest, mode: 'preflight' | 'verify'): Promise<ReadinessResult> {
    const config = integrationConfig(plan, mode);
    if (!config.checks.length && !config.pairings.length) return { pending: [] };
    let created = false;
    try {
      try { await run({ command: engine, args: ['network', 'inspect', network] }); }
      catch {
        await run({ command: engine, args: ['network', 'create', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.network=stack', network] });
        created = true;
      }
      const result = JSON.parse(await run({ command: engine, args: ['run', '--rm', '-i', '--network', network, manifest.images.runtime!.id, '/app/runtime/integration.js', '--stdin'], input: JSON.stringify(config), label: 'Service connection verification' })) as ReadinessResult & { error?: string };
      if (result.error) throw new DeploymentError(`Service connection verification: ${result.error}`);
      if (!Array.isArray(result.pending) || result.pending.some(item => typeof item !== 'string')) throw new DeploymentError('Invalid integration verification result');
      return result;
    } finally {
      // Preflight must not leave a new network behind if the operator cancels.
      if (created && mode === 'preflight') await run({ command: engine, args: ['network', 'rm', network] });
    }
  }
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
    async prepareInternalProxy(manifest, settings) {
      if (!resolveDeployment(settings).services.includes('cli-proxy-api')) throw new DeploymentError('Internal model preparation requires local CLIProxyAPI');
      validateDeploymentImages(manifest, ['runtime', 'cli-proxy-api']);
      await checkProvider();
      // Isolate preparation from the full deployment: its consumers can still
      // have missing model names, and their applied files must remain intact.
      const stage = join(directory, '.ams/internal-proxy');
      await mkdir(stage, { recursive: true, mode: 0o700 });
      const proxySettings = validateEnv({
        AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api',
        DATA_DIR: resolve(directory, settings.DATA_DIR),
        CLIPROXY_API_KEY: settings.CLIPROXY_API_KEY,
        CLIPROXY_AUTH_PROVIDER: settings.CLIPROXY_AUTH_PROVIDER,
        CLIPROXY_SERVICE_ENABLED: settings.CLIPROXY_SERVICE_ENABLED,
        CLIPROXY_SERVICE_PORT: settings.CLIPROXY_SERVICE_PORT,
      });
      await atomicWrite(join(stage, '.env'), encodeEnv(proxySettings));
      await atomicWrite(join(stage, 'compose.yaml'), renderCompose(proxySettings));
      await atomicWrite(join(stage, 'compose.env'), encodeEnv({ DATA_DIR: proxySettings.DATA_DIR,
        ...Object.fromEntries((['runtime', 'cli-proxy-api'] as const).map(service => [imageVariables[service], manifest.images[service]!.id])),
      }));
      await compose(['config'], undefined, false, stage);
      await compose(['run', '--rm', '--no-deps', 'config'], undefined, false, stage);
      await compose(['up', '-d', '--no-deps', '--force-recreate', 'cli-proxy-api'], undefined, false, stage);
      await waitFor('cli-proxy-api', 'running');
      proxyStage = stage;
    },
    async discoverInternalModels(manifest, settings) {
      validateDeploymentImages(manifest, ['runtime']);
      const endpoint = internalLLM(settings);
      let result: { models?: unknown; status?: number };
      try {
        result = JSON.parse(await run({ command: engine,
          args: ['run', '--rm', '-i', '--network', network, manifest.images.runtime!.id, '/app/runtime/model-discovery.js', '--stdin'],
          input: JSON.stringify({ baseUrl: endpoint.baseURL, apiKey: endpoint.apiKey }),
          label: 'Discover CLIProxyAPI models', timeoutMs: 5000,
        })) as typeof result;
      } catch { return []; }
      if (result?.status === 401 || result?.status === 403) throw new InternalModelAccessError(result.status);
      if (!Array.isArray(result?.models)) return [];
      return [...new Set(result.models.filter((id): id is string => typeof id === 'string'
        && !!id.trim() && id === id.trim() && !/[\x00-\x1f\x7f-\x9f]/.test(id)))];
    },
    async reservePorts(manifest, settings) {
      await checkProvider();
      return reservePublishedPorts(engine, project, manifest, resolveDeployment(settings).interfaces, run);
    },
    async snapshot(manifest) {
      validateDeploymentImages(manifest, ['runtime']);
      await run({ command: engine, args: ['run', '--rm', '--network', 'none', '--user', '0:0', '-v', `${directory}:/state`, manifest.images.runtime!.id, '/app/runtime/snapshot.js', '/state'], label: 'Preserve previous installation settings' });
    },
    async preflight(manifest, settings) {
      const plan = settings ? resolveDeployment(settings) : await readPlan();
      validateDeploymentImages(manifest, plan.requiredImages as ImageService[]);
      await checkProvider();
      const info = JSON.parse(await run({ command: engine, args: ['info', '--format', '{{json .}}'] }));
      const architecture = info.host?.arch ?? info.Host?.Arch ?? info.Architecture;
      const arch = ({ aarch64: 'arm64', x86_64: 'amd64' } as Record<string, string>)[architecture] ?? architecture;
      const platform = `linux/${arch}` as ImagePlatform;
      validateDeploymentImages(manifest, plan.requiredImages as ImageService[], platform);
      for (const service of plan.requiredImages as ImageService[]) {
        const identity = manifest.images[service]!;
        const [actual] = JSON.parse(await run({ command: engine, args: ['image', 'inspect', identity.id] }));
        if (`sha256:${String(actual.Id).replace(/^sha256:/, '')}` !== identity.id
          || `${actual.Os}/${actual.Architecture}` !== platform) throw new DeploymentError(`Image identity/platform mismatch: ${service}`);
      }
      return probe(plan, manifest, 'preflight');
    },
    async apply(adminKey, options = {}) {
      const plan = await readPlan();
      if (adminKey !== undefined && !plan.services.includes('core')) throw new DeploymentError('Administrator initialization belongs to the machine running Core');
      const manifest = await loadManifest(join(directory, '.ams/images.json'), plan.requiredImages as ImageService[]);
      const applied = await readAppliedInventory(directory);
      await compose(['config']);
      const owned = await ownedContainers();
      if (owned.length) await run({ command: engine, args: ['stop', ...owned.map(item => item.id)], label: 'Stop this installation before applying configuration' });
      const obsolete = owned.filter(item => !plan.containers.includes(item.service));
      if (obsolete.length) await run({ command: engine, args: ['rm', ...obsolete.map(item => item.id)], label: 'Remove deselected containers; preserve data' });
      await compose(['run', '--rm', '--no-deps', 'config']);
      proxyStage = undefined;
      const ready = new Set(['config']);
      if (plan.readiness.some(edge => ['core', 'knowledge'].includes(edge.service) && edge.dependsOn.includes('cli-proxy-api'))) {
        await compose(['up', '-d', '--no-deps', '--force-recreate', 'cli-proxy-api']);
        await waitFor('cli-proxy-api', 'running');
        ready.add('cli-proxy-api');
      }
      if (plan.services.includes('core')) {
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
          if (adminKey === undefined && (!applied?.services.includes('core') || applied.coreInitialized === false)) {
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
      }
      let remaining = plan.containers.filter(name => !ready.has(name));
      while (remaining.length) {
        const next = remaining.filter(name => (plan.readiness.find(edge => edge.service === name)?.dependsOn ?? (['access', 'knowledge-service'].includes(name) ? ['knowledge'] : [])).every(dependency => ready.has(dependency)));
        if (!next.length) throw new DeploymentError('Local readiness dependencies contain a cycle');
        await compose(['up', '-d', '--no-deps', '--force-recreate', ...next]);
        for (const service of next) { await waitFor(service, service === 'cli-proxy-api' ? 'running' : 'healthy'); ready.add(service); }
        remaining = remaining.filter(name => !ready.has(name));
      }
      await mkdir(join(directory, '.ams'), { recursive: true });
      await atomicWrite(join(directory, '.ams/applied.json'), JSON.stringify({ version: 1, services: plan.containers }, null, 2) + '\n');
      const result = await probe(plan, manifest, 'verify');
      await atomicWrite(join(directory, '.ams/readiness.json'), JSON.stringify(result, null, 2) + '\n');
      if (result.pending.length && !options.allowPending) throw new DeploymentError(`Integration is pending: ${result.pending.join(', ')}. Run setup with explicit staged start after checking peer services.`);
      await rm(join(directory, '.ams/apply-pending'), { force: true });
      return result;
    },
    async hasProviderAuthorization(provider) {
      const settings = validateEnv(await readEnv(join(directory, '.env')), { allowPendingModels: true });
      if (!resolveDeployment(settings).services.includes('cli-proxy-api')) return false;
      const manifest = await loadManifest(join(directory, '.ams/images.json'), ['runtime']);
      const authDirectory = resolve(directory, settings.DATA_DIR, 'cli-proxy-api/auth');
      const output = await run({ command: engine, args: ['run', '--rm', '--network', 'none',
        '-v', `${authDirectory}:/auth:ro`, manifest.images.runtime!.id,
        '/app/runtime/provider-auth.js', '/auth', provider], label: 'Check saved provider authorization', timeoutMs: 15_000 });
      if (!['true', 'false'].includes(output.trim())) throw new DeploymentError('Invalid provider authorization check result');
      return output.trim() === 'true';
    },
    async login(provider) {
      const plan = resolveDeployment(validateEnv(await readEnv(join(directory, '.env')), { allowPendingModels: true }));
      if (!plan.services.includes('cli-proxy-api')) throw new DeploymentError('Provider login runs on the machine hosting CLIProxyAPI');
      await compose(['stop', 'cli-proxy-api'], undefined, false, proxyStage);
      try { await compose(['run', '--rm', '--no-deps', 'cli-proxy-api', '-config', '/config/cli-proxy-api.yaml', accountProviders[provider].loginFlag, '-no-browser'], undefined, true, proxyStage); }
      finally { await compose(['up', '-d', '--no-deps', 'cli-proxy-api'], undefined, false, proxyStage); }
    },
    status: () => compose(['ps']),
  };
}
export async function loadManifest(path: string, required?: readonly ImageService[]): Promise<ImageManifest> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new DeploymentError('Cannot read installation image records; rerun ams to prepare images'); }
  return required ? validateDeploymentImages(parsed, required) : validateImageManifest(parsed, false);
}
