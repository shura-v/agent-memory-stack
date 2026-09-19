import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, decodeEnv, encodeEnv } from '../config/files.js';
import { generateKey, reviewSettings, resolveSettings } from '../config/settings.js';
import { catalog, resolveDeployment } from '../deployment/model.js';
import { runtimeFor } from '../runtime/compose.js';
import { imageVariables, renderCompose } from '../runtime/render-compose.js';
import type { DeploymentRuntime, Provider } from '../runtime/compose.js';
import type { Interaction } from './interaction.js';
import { serverQuestions } from './questions.js';
import type { ModelDiscovery } from './model-discovery.js';
import { prepareImages } from './images.js';
import { DeploymentError, PortBindingConflict } from '../runtime/errors.js';
import { captureInputs, exists, preserveInputs, recordAppliedInputs, restoreSnapshotInputs } from './server-settings.js';
import { saveResolvedNetwork } from './network-settings.js';
import { accountProviders } from '../config/providers.js';
import type { AccountProvider } from '../config/providers.js';
import type { ServiceInterface } from '../deployment/model.js';
import { readInstallationEnv, readNativeConfiguration, prepareNativeConfiguration, saveNativeConfiguration, orchestrationEnv, stageNativeRuntime, assertNativeConfigurationCurrent, captureNativeConfiguration } from '../config/native-state.js';
import { normalizeNativeServiceConfigs } from '../config/native-services.js';
import { validateTdaiSource, type SourceLock } from '../build/sources.js';
import { configurationDirectory, displayHomePath } from './paths.js';

function interfaceDescription(item: ServiceInterface): string {
  if (item.service === 'mcp') return `MCP: 127.0.0.1:${item.port}/mcp (Knowledge tools, Streamable HTTP)`;
  if (item.service === 'panel') return `Panel: 127.0.0.1:${item.port} (web interface)`;
  if (item.service === 'memory-proxy') return `MemoryProxy: 127.0.0.1:${item.port} (agent API)`;
  return `${item.service}: 127.0.0.1:${item.port} (${item.audience === 'service' ? 'authenticated service consumers; operator-managed forwarding' : 'agent tools'})`;
}

export interface ServerSetupOptions {
  directory?: string;
  nativeRoot?: string;
  runtime?: (directory: string, provider: Provider) => DeploymentRuntime;
  listModels?: ModelDiscovery;
  prepareImages?: typeof prepareImages;
}

export async function savedProvider(directory: string): Promise<Provider> {
  try {
    const { provider } = JSON.parse(await readFile(join(directory, '.ams/runtime.json'), 'utf8'));
    return provider;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'docker';
    throw new DeploymentError('Cannot read the saved container engine in .ams/runtime.json. Repair this file or restore its backup before running ams.');
  }
}

export async function setupServer(ui: Interaction, options: ServerSetupOptions = {}): Promise<void> {
  const directory = resolve(options.directory ?? configurationDirectory());
  ui.note(`AMS saves compose.yaml and .env in ${displayHomePath(directory)}. Services run in Docker/Podman containers.`, 'Compose configuration');
  const existing = await readInstallationEnv(directory, options.nativeRoot);
  ui.note(catalog.map(service => `${service.label} (${service.description})`).join('\n'), 'Full stack');
  const provider = await ui.select<Provider>('provider', 'Container engine / Compose provider', [
    { value: 'docker', label: 'Docker Compose' }, { value: 'podman', label: 'Podman compose (configured provider)' },
    { value: 'podman-compose', label: 'Podman + podman-compose' }, { value: 'uvx-podman-compose', label: 'Podman + uvx podman-compose' },
  ], await savedProvider(directory));
  const env = await serverQuestions(ui, existing, { listModels: options.listModels });
  const plan = resolveDeployment(env);
  const interfaces = plan.interfaces.map(interfaceDescription);
  ui.note(`Local services: ${plan.services.join(', ')}\nRequired helpers: ${plan.helpers.join(', ')}\n${interfaces.join('\n')}\nExisting data and local credentials are retained.`, 'Review deployment');
  ui.note(reviewSettings({ ...env, DATA_DIR: displayHomePath(env.DATA_DIR) }), 'Review configuration (secrets redacted)');
  ui.note('Setup will reuse matching local images and build missing or outdated images for the full stack. The first build downloads pinned sources and dependencies. Image records are managed automatically.', 'Container images');
  ui.commit?.();
  await preserveInputs(directory, options.nativeRoot);
  const initialInput = { ...env };
  for (const name of ['MEMORY_LLM_MAX_TOKENS', 'MEMORY_LLM_TIMEOUT_MS', 'KNOWLEDGE_LLM_MAX_TOKENS', 'KNOWLEDGE_LLM_TIMEOUT_MS']) if (!Object.hasOwn(existing, name)) delete initialInput[name];
  const deferOrigins = ['MEMORY_PROXY_PUBLIC_URL', 'KNOWLEDGE_PUBLIC_URL'].filter(name => existing[name] === undefined);
  const pendingSourcePath = join(directory, '.ams/pending-tdai-source.json');
  let initialSource: SourceLock | undefined;
  // A fresh offline import supplies Configure's first defaults; existing installations keep their active source until Apply.
  if (!await exists(join(directory, '.ams/tdai-source.json')) && !await readNativeConfiguration(directory, options.nativeRoot)
    && await exists(pendingSourcePath)) {
    initialSource = validateTdaiSource(JSON.parse(await readFile(pendingSourcePath, 'utf8')));
  }
  const native = await prepareNativeConfiguration(directory, initialInput, { root: options.nativeRoot, source: initialSource, deferOrigins,
    edits: Object.fromEntries(Object.entries(initialInput).filter(([name, value]) => existing[name] !== value && !deferOrigins.includes(name))) });
  await saveNativeConfiguration(directory, native);
  // Pin Configure's source so a later package upgrade cannot silently replace defaults.
  if (!await exists(join(directory, '.ams/tdai-source.json'))) {
    await atomicWrite(join(directory, '.ams/tdai-source.json'), JSON.stringify(native.source, null, 2) + '\n');
  }
  await atomicWrite(join(directory, '.env'), encodeEnv(orchestrationEnv(env)));
  await atomicWrite(join(directory, '.ams/runtime.json'), JSON.stringify({ provider }, null, 2) + '\n');
  ui.note(`Configuration saved in ${displayHomePath(directory)}.\nApply it later with: ams apply`, 'Configuration saved');
  if (await ui.confirm('apply', 'Apply configuration now?', true)) await applyServer(ui, directory, options);
}

/** Apply the saved editable configuration; setup and the standalone command share this path. */
export async function applyServer(ui: Interaction, directory: string, options: ServerSetupOptions = {}): Promise<void> {
  directory = resolve(directory);
  let env: Record<string, string>;
  try {
    const raw = await readInstallationEnv(directory, options.nativeRoot);
    if (!Object.keys(raw).length) throw new Error();
    env = resolveSettings(raw);
  } catch (error) {
    if (error instanceof DeploymentError) throw error;
    throw new DeploymentError('Cannot read saved configuration. Check orchestration .env and native defaults/overrides, or run ams before applying.');
  }
  const provider = await savedProvider(directory);
  const runtime = (options.runtime ?? runtimeFor)(directory, provider);
  await runtime.checkProvider?.();
  const pendingSourcePath = join(directory, '.ams/pending-tdai-source.json');
  const sourceInput = await exists(pendingSourcePath) ? await readFile(pendingSourcePath, 'utf8') : undefined;
  const activeSourcePath = join(directory, '.ams/tdai-source.json');
  let expectedActiveSource = await exists(activeSourcePath) ? await readFile(activeSourcePath, 'utf8') : undefined;
  let expectedOrchestration = await readFile(join(directory, '.env'), 'utf8');
  const assertCurrentInputs = async () => {
    const currentSource = await exists(pendingSourcePath) ? await readFile(pendingSourcePath, 'utf8') : undefined;
    const activeSource = await exists(activeSourcePath) ? await readFile(activeSourcePath, 'utf8') : undefined;
    if (currentSource !== sourceInput || activeSource !== expectedActiveSource || await readFile(join(directory, '.env'), 'utf8') !== expectedOrchestration) throw new DeploymentError('Saved configuration or target revision changed during preparation; run ams apply again');
  };
  let source: SourceLock | undefined;
  try { source = sourceInput === undefined ? undefined : validateTdaiSource(JSON.parse(sourceInput)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let native = await prepareNativeConfiguration(directory, env, { root: options.nativeRoot, source });
  const initializeOrigins = !native.originsFinalized;
  env = resolveSettings(normalizeNativeServiceConfigs(env, native.documents));
  if (native.diagnostics.length) ui.note(native.diagnostics.map(item => `${item.file}:${item.path} — ${item.reason}`).join('\n'), 'Changed upstream defaults');
  let adminKey: string | undefined;
  const createAdminKey = async () => {
    if (adminKey) return adminKey;
    const key = generateKey('admin');
    await ui.handoff(key);
    ui.note('Initializing Core administrator and starting the remaining services...');
    adminKey = key;
    return key;
  };
  ui.commit?.();
  await preserveInputs(directory, options.nativeRoot);
  const manifest = await (options.prepareImages ?? prepareImages)({
    projectDir: directory, source, runtime: provider === 'docker' ? 'docker' : 'podman',
    note: message => ui.note(message, 'Container images'),
  });
  await assertCurrentInputs();
  await assertNativeConfigurationCurrent(directory, native);
  await runtime.preflight(manifest, env);
  await assertCurrentInputs();
  await mkdir(join(directory, '.ams'), { recursive: true, mode: 0o700 });
  const snapshotPending = await exists(join(directory, '.ams/apply-pending'));
  await runtime.snapshot?.(manifest);
  if (runtime.snapshot && !snapshotPending) await restoreSnapshotInputs(directory);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const reservation = await runtime.reservePorts?.(manifest, env);
    try {
      await assertCurrentInputs();
      await assertNativeConfigurationCurrent(directory, native);
      const previous = env;
      env = await saveResolvedNetwork(directory, env, reservation?.ports ?? {}, { initializeOrigins });
      expectedOrchestration = await readFile(join(directory, '.env'), 'utf8');
      const resolved = resolveDeployment(env);
      native = await prepareNativeConfiguration(directory, env, { root: options.nativeRoot, source });
      const changed = resolved.interfaces.filter(item => previous[item.field] !== String(item.port));
      if (changed.length) ui.note(changed.map(item => `${item.service}: 127.0.0.1:${previous[item.field]} → 127.0.0.1:${item.port}`).join('\n')
        + '\nUpdate any Caddy upstreams and explicit native origin overrides that use these ports.', 'Resolved ports');
      await assertCurrentInputs();
      await saveNativeConfiguration(directory, native);
      // Initial origins belong to the staged attempt until its containers start successfully.
      if (initializeOrigins) native = await prepareNativeConfiguration(directory, env, { root: options.nativeRoot, source, finalizeOrigins: true });
      env = resolveSettings(normalizeNativeServiceConfigs(env, native.documents));
      const orchestration = orchestrationEnv(env);
      const savedOrchestration = decodeEnv(await readFile(join(directory, '.env'), 'utf8'));
      if (Object.keys(savedOrchestration).length !== Object.keys(orchestration).length
        || Object.entries(orchestration).some(([name, value]) => savedOrchestration[name] !== value)) {
        await atomicWrite(join(directory, '.env'), encodeEnv(orchestration));
      }
      await atomicWrite(join(directory, '.ams/images.json'), JSON.stringify(manifest, null, 2) + '\n');
      expectedActiveSource = JSON.stringify(native.source, null, 2) + '\n';
      await atomicWrite(activeSourcePath, expectedActiveSource);
      expectedOrchestration = await readFile(join(directory, '.env'), 'utf8');
      const generation = await stageNativeRuntime(directory, native, env);
      await atomicWrite(join(directory, 'compose.yaml'), renderCompose(env, { generation, root: native.root }));
      const composeEnv = resolved.requiredImages.map(service => `${imageVariables[service]}=${manifest.images[service]!.id}`);
      for (const key of ['DATA_DIR', ...resolved.interfaces.map(item => item.field)]) composeEnv.push(`${key}='${env[key].replace(/'/g, "\\'")}'`);
      await atomicWrite(join(directory, '.ams/compose.env'), composeEnv.join('\n') + '\n');
      const appliedInputs = await captureInputs(directory);
      // Helpers hold engine bindings until the containers are ready to take over.
      await reservation?.release();
      ui.note('Applying the full local stack. Each readiness stage can take up to 90 seconds.');
      await runtime.apply(undefined, { createAdminKey });
      if (initializeOrigins) {
        await saveNativeConfiguration(directory, native);
        appliedInputs['.ams/native-config.json'] = await readFile(join(directory, '.ams/native-config.json'), 'utf8');
        appliedInputs['.ams/native-backup.json'] = await captureNativeConfiguration(directory);
      }
      await recordAppliedInputs(directory, appliedInputs);
      await rm(join(directory, '.ams/pending-tdai-source.json'), { force: true });
      await rm(join(directory, '.ams/pending-images.json'), { force: true });
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
  ui.note('Full local stack started. External access, model authorization and semantic memory are separate checks.');
  await authorizeProxy(ui, runtime, env.CLIPROXY_AUTH_PROVIDER as AccountProvider);
  ui.note('Run ams and choose Show connection details to see connection ports and all configured keys.', 'Connection details');
}

/** Authorize the selected account after applying the complete stack. */
async function authorizeProxy(ui: Interaction, runtime: DeploymentRuntime, provider: AccountProvider): Promise<void> {
  if (await runtime.hasProviderAuthorization?.(provider)) return;
  if (ui.interactive === false) throw new DeploymentError(`CLIProxyAPI ${accountProviders[provider].label} authorization is missing. Run ams apply in an interactive terminal to sign in.`);
  if (provider === 'claude') ui.note('Open the displayed URL in your browser. When redirected to localhost, copy the full callback URL from the address bar, even if the page cannot connect. Paste it when the terminal prompts after 15 seconds; do not submit an empty answer. No public callback port is required.', 'Claude login');
  await runtime.login(provider);
  if (runtime.hasProviderAuthorization && !await runtime.hasProviderAuthorization(provider)) {
    throw new DeploymentError(`${accountProviders[provider].label} login did not save authorization. Run ams apply to retry.`);
  }
}
