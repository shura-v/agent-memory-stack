import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, encodeEnv, readEnv } from '../config/files.js';
import { fields, generateKey, reviewSettings, validateEnv } from '../config/settings.js';
import { resolveDeployment } from '../deployment/model.js';
import { readAppliedInventory, runtimeFor } from '../runtime/compose.js';
import { imageVariables, renderCompose } from '../runtime/render-compose.js';
import type { DeploymentRuntime, Provider } from '../runtime/compose.js';
import type { ImageService } from '../build/images.js';
import { Cancelled } from './interaction.js';
import type { Interaction } from './interaction.js';
import { selectServices, serverQuestions, selectModel } from './questions.js';
import type { ModelDiscovery } from './model-discovery.js';
import { prepareImages } from './images.js';
import { DeploymentError, PortBindingConflict } from '../runtime/errors.js';
import { captureInputs, exists, preserveInputs, recordAppliedInputs, restoreSnapshotInputs } from './server-settings.js';
import { saveResolvedNetwork } from './network-settings.js';
import { accountProviders } from '../config/providers.js';
import type { AccountProvider } from '../config/providers.js';
import type { ServiceInterface } from '../deployment/model.js';
import { internalModelFields, usesLocalInternalModels } from '../config/internal-llm.js';
import { configurationDirectory, displayHomePath } from './paths.js';

function interfaceDescription(item: ServiceInterface): string {
  if (item.service === 'mcp') return `MCP: 127.0.0.1:${item.port}/mcp (Knowledge tools, Streamable HTTP)`;
  if (item.service === 'panel') return `Panel: 127.0.0.1:${item.port} (web interface)`;
  if (item.service === 'memory-proxy') return `MemoryProxy: 127.0.0.1:${item.port} (agent API)`;
  return `${item.service}: 127.0.0.1:${item.port} (${item.audience === 'service' ? 'authenticated service consumers; operator-managed forwarding' : 'agent tools'})`;
}

async function appliedServices(directory: string, existing: Record<string, string>): Promise<string[]> {
  const inventory = await readAppliedInventory(directory);
  return inventory?.services ?? (Object.keys(existing).length ? resolveDeployment(existing, { requireConnections: false }).containers : []);
}

export interface ServerSetupOptions {
  directory?: string;
  runtime?: (directory: string, provider: Provider) => DeploymentRuntime;
  listModels?: ModelDiscovery;
  prepareImages?: typeof prepareImages;
}

export async function savedProvider(directory: string): Promise<Provider> {
  try {
    const { provider } = JSON.parse(await readFile(join(directory, '.ams/runtime.json'), 'utf8'));
    if (!['docker', 'podman', 'podman-compose', 'uvx-podman-compose'].includes(provider)) throw new DeploymentError('Invalid saved container engine in .ams/runtime.json. Run ams and select the container engine again.');
    return provider;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'docker';
    throw new DeploymentError('Cannot read the saved container engine in .ams/runtime.json. Repair this file or restore its backup before running ams.');
  }
}

export async function setupServer(ui: Interaction, options: ServerSetupOptions = {}): Promise<void> {
  const directory = resolve(options.directory ?? configurationDirectory());
  ui.note(`AMS saves compose.yaml and .env in ${displayHomePath(directory)}. Services run in Docker/Podman containers.`, 'Compose configuration');
  const existing = await readEnv(join(directory, '.env'));
  const services = await selectServices(ui, existing);
  const provider = await ui.select<Provider>('provider', 'Container engine / Compose provider', [
    { value: 'docker', label: 'Docker Compose' }, { value: 'podman', label: 'Podman compose (configured provider)' },
    { value: 'podman-compose', label: 'Podman + podman-compose' }, { value: 'uvx-podman-compose', label: 'Podman + uvx podman-compose' },
  ], await savedProvider(directory));
  const env = await serverQuestions(ui, existing, services, { listModels: options.listModels });
  const plan = resolveDeployment(env);
  const previousContainers = await appliedServices(directory, existing);
  const added = plan.containers.filter(service => !previousContainers.includes(service));
  const removed = previousContainers.filter(service => !plan.containers.includes(service));
  const connections = Object.entries(plan.connections).filter(([, connection]) => connection.consumers.length).map(([name, connection]) =>
    `${name}: ${connection.mode}${connection.mode === 'remote' ? ` (${connection.endpoint ?? connection.origin})` : ''}`);
  const interfaces = plan.interfaces.map(interfaceDescription);
  ui.note(`Local services: ${plan.services.join(', ')}\nRequired helpers: ${plan.helpers.join(', ')}\nAdded containers: ${added.join(', ') || 'none'}\nRemoved containers: ${removed.join(', ') || 'none'}\n${connections.join('\n')}\n${interfaces.join('\n')}\nExisting data and local credentials are retained. Changing placement does not migrate data or operate another machine.`, 'Review deployment');
  ui.note(reviewSettings({ ...env, DATA_DIR: displayHomePath(env.DATA_DIR) }), 'Review configuration (secrets redacted)');
  ui.note('Setup will reuse matching local images and build missing or outdated images for the configured services. The first build downloads pinned sources and dependencies. Image records are managed automatically.', 'Container images');
  ui.commit?.();
  await preserveInputs(directory);
  await atomicWrite(join(directory, '.env'), encodeEnv(env));
  await atomicWrite(join(directory, '.ams/runtime.json'), JSON.stringify({ provider }, null, 2) + '\n');
  ui.note(`Configuration saved in ${displayHomePath(directory)}.\nApply it later with: ams apply`, 'Configuration saved');
  if (await ui.confirm('apply', 'Apply configuration now?', true)) await applyServer(ui, directory, options);
}

/** Apply the saved editable configuration; setup and the standalone command share this path. */
export async function applyServer(ui: Interaction, directory: string, options: ServerSetupOptions = {}): Promise<void> {
  directory = resolve(directory);
  let env: Record<string, string>;
  try {
    const raw = await readEnv(join(directory, '.env'));
    if (!Object.keys(raw).length) throw new Error();
    env = validateEnv(raw, { allowPendingModels: true });
  } catch {
    throw new DeploymentError('Cannot read a valid saved server configuration from .env. Check this file or run ams before applying.');
  }
  const localModels = usesLocalInternalModels(env);
  const pendingModels = internalModelFields(env).filter(name => !env[name]);
  if (localModels && pendingModels.length && ui.interactive === false) {
    throw new DeploymentError(`Set ${pendingModels.join(', ')} in .env or run ams apply in an interactive terminal to select models after CLIProxyAPI authorization.`);
  }
  const plan = resolveDeployment(env);
  const services = plan.services;
  const provider = await savedProvider(directory);
  const runtime = (options.runtime ?? runtimeFor)(directory, provider);
  await runtime.checkProvider?.();
  let adminKey: string | undefined;
  const createAdminKey = services.includes('core') ? async () => {
    if (adminKey) return adminKey;
    const key = generateKey('admin');
    await ui.handoff(key);
    ui.note('Initializing Core administrator and starting the remaining services...');
    adminKey = key;
    return key;
  } : undefined;
  ui.commit?.();
  await preserveInputs(directory);
  const manifest = await (options.prepareImages ?? prepareImages)({
    projectDir: directory, runtime: provider === 'docker' ? 'docker' : 'podman',
    services: plan.requiredImages as ImageService[], note: message => ui.note(message, 'Container images'),
  });
  const preflight = await runtime.preflight(manifest, env);
  let allowPending = false;
  if (preflight?.pending.length) {
    ui.note(`Unavailable integrations:\n${preflight.pending.join('\n')}\nThese operations remain unavailable until both machines are running and verification succeeds.`, 'Staged start');
    allowPending = await ui.confirm('staged-start', 'Start the local services with these integrations marked pending?', false);
    if (!allowPending) throw new Cancelled();
  }
  await mkdir(join(directory, '.ams'), { recursive: true, mode: 0o700 });
  const snapshotPending = await exists(join(directory, '.ams/apply-pending'));
  await runtime.snapshot?.(manifest);
  if (runtime.snapshot && !snapshotPending) await restoreSnapshotInputs(directory);
  await atomicWrite(join(directory, '.ams/images.json'), JSON.stringify(manifest, null, 2) + '\n');
  let result: Awaited<ReturnType<DeploymentRuntime['apply']>> = undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const reservation = await runtime.reservePorts?.(manifest, env);
    try {
      const previous = env;
      env = await saveResolvedNetwork(directory, env, reservation?.ports ?? {});
      const resolved = resolveDeployment(env);
      const changed = resolved.interfaces.filter(item => previous[item.field] !== String(item.port));
      if (changed.length) ui.note(changed.map(item => `${item.service}: 127.0.0.1:${previous[item.field]} → 127.0.0.1:${item.port}`).join('\n')
        + '\nUpdate any Caddy upstreams that use these ports.', 'Resolved ports');
      if (localModels) {
        if (!runtime.prepareInternalProxy || !runtime.discoverInternalModels) throw new DeploymentError('This runtime cannot prepare CLIProxyAPI for internal models. Update AMS and retry ams apply.');
        await reservation?.release();
        ui.note('Preparing CLIProxyAPI before starting Core and Knowledge.', 'Internal models');
        await runtime.prepareInternalProxy(manifest, env);
        await authorizeProxy(ui, runtime, env.CLIPROXY_AUTH_PROVIDER as AccountProvider);
        const missing = internalModelFields(env).filter(name => !env[name]);
        if (missing.length) {
          ui.note('Loading available models from CLIProxyAPI (up to 5 seconds).', 'Models');
          const models = await runtime.discoverInternalModels(manifest, env);
          if (!models.length) ui.note('No model list is available. Enter the model names manually.', 'Models');
          for (const name of missing) {
            env[name] = await selectModel(ui, fields.find(field => field.name === name)!, models);
            // Keep each completed answer so a cancelled Apply resumes at the next model.
            const path = join(directory, '.env');
            const source = await readFile(path, 'utf8');
            const line = encodeEnv({ [name]: env[name] }).trimEnd();
            const expression = new RegExp(`^${name}=.*$`, 'gm');
            await atomicWrite(path, expression.test(source) ? source.replace(expression, () => line)
              : `${source}${source.endsWith('\n') ? '' : '\n'}${line}\n`);
          }
        }
        env = validateEnv(env);
      }
      await atomicWrite(join(directory, 'compose.yaml'), renderCompose(env));
      const composeEnv = resolved.requiredImages.map(service => `${imageVariables[service as ImageService]}=${manifest.images[service as ImageService]!.id}`);
      for (const key of ['DATA_DIR', ...resolved.interfaces.map(item => item.field)]) composeEnv.push(`${key}='${env[key].replace(/'/g, "\\'")}'`);
      await atomicWrite(join(directory, '.ams/compose.env'), composeEnv.join('\n') + '\n');
      const appliedInputs = await captureInputs(directory);
      // Helpers hold engine bindings until the containers are ready to take over.
      await reservation?.release();
      ui.note('Applying selected local services. Each readiness stage can take up to 90 seconds.');
      result = await runtime.apply(undefined, { allowPending, createAdminKey });
      await recordAppliedInputs(directory, appliedInputs);
      break;
    } catch (error) {
      if (!(error instanceof PortBindingConflict) || !runtime.reservePorts) throw error;
      if (attempt === 3) throw new DeploymentError(`${error.message}. Published ports were claimed during startup after 3 attempts. Stop the competing listener or retry ams apply. The previous applied settings remain in .ams/previous-settings.`);
      ui.note(`A published port was claimed during startup. Selecting available ports again (attempt ${attempt + 1} of 3).`, 'Port conflict');
    } finally {
      await reservation?.release();
    }
  }
  adminKey = undefined;
  const interfaces = resolveDeployment(env).interfaces.map(interfaceDescription);
  ui.note(interfaces.join('\n'), 'Published loopback interfaces');
  ui.note(result?.pending.length ? `Local processes started; integrations pending:\n${result.pending.join('\n')}\nRun ams apply after their peers are available.` : 'Selected local containers started. External access, model authorization and semantic memory are separate checks.');
  if (services.includes('cli-proxy-api') && !localModels) {
    await authorizeProxy(ui, runtime, env.CLIPROXY_AUTH_PROVIDER as AccountProvider);
  }
  ui.note('Run ams and choose Show connection details to see connection ports and all configured keys.', 'Connection details');
}

/** Share provider-specific authorization between early local preparation and normal external Apply. */
async function authorizeProxy(ui: Interaction, runtime: DeploymentRuntime, provider: AccountProvider): Promise<void> {
  if (await runtime.hasProviderAuthorization?.(provider)) return;
  if (ui.interactive === false) throw new DeploymentError(`CLIProxyAPI ${accountProviders[provider].label} authorization is missing. Run ams apply in an interactive terminal to sign in.`);
  if (provider === 'claude') ui.note('Open the displayed URL in your browser. When redirected to localhost, copy the full callback URL from the address bar, even if the page cannot connect. Paste it when the terminal prompts after 15 seconds; do not submit an empty answer. No public callback port is required.', 'Claude login');
  await runtime.login(provider);
  if (runtime.hasProviderAuthorization && !await runtime.hasProviderAuthorization(provider)) {
    throw new DeploymentError(`${accountProviders[provider].label} login did not save authorization. Run ams apply to retry.`);
  }
}
