import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { atomicWrite, readEnv } from './files.js';
import { loadSourceLock, validateTdaiSource, type SourceLock } from '../build/sources.js';
import { getNativeTemplates, nativeFileNames, nativeTemplateDefinitions, type NativeFileName, type NativeTemplateManifest } from './native-templates.js';
import { composeNativeDocument, nativeTemplateChanges, validateNativeDeletions, parseNativeDocument, updateNativeDocument, type NativeFormat, type NativeValue } from './native-documents.js';
import { seedNativeServiceConfigs, editNativeServiceOverrides, normalizeNativeServiceConfigs, nativeRuntimeConfigs, type NativeServiceDocuments } from './native-services.js';
import { DeploymentError } from '../runtime/errors.js';
import { isNativeSetting } from './settings.js';

export interface NativeState { version: 1; runtime: string; source: SourceLock; manifest: NativeTemplateManifest; originsFinalized: boolean }
export interface NativeConfiguration { root: string; state: NativeState; defaults: NativeServiceDocuments; overrides: NativeServiceDocuments; deletions?: string }
export interface NativeCandidate extends NativeConfiguration { documents: NativeServiceDocuments; baseFingerprint: string; source: SourceLock; diagnostics: Array<{ file: string; path: string; reason: string }> }
const stateName = '.ams-state.json';
const referenceName = '.ams/native-config.json';
const format = (name: string): NativeFormat => name.endsWith('.yaml') ? 'yaml' : name.endsWith('.env') ? 'env' : 'json';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry) ?? 'undefined').digest('hex');
const sameSource = (left: SourceLock, right: SourceLock) => left.revision === right.revision && left.sha256 === right.sha256 && left.url === right.url;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function parseMetadata(text: string): any {
  try { return JSON.parse(text); } catch { throw new DeploymentError('Invalid native configuration metadata; restore its saved copy'); }
}
async function readOptional(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new DeploymentError(`Configuration must be a regular file: ${path}`);
    return await readFile(path, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function protectedDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new DeploymentError(`Configuration must be a directory: ${path}`);
  await chmod(path, 0o700);
}
export async function nativeConfigurationRoot(directory: string, initialRoot?: string): Promise<string> {
  const saved = await readOptional(join(directory, referenceName));
  if (saved) {
    const reference = parseMetadata(saved);
    if (reference.version !== 1 || typeof reference.root !== 'string' || !isAbsolute(reference.root)) throw new DeploymentError('Invalid .ams/native-config.json; restore the native configuration reference');
    return reference.root;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (!initialRoot && xdg && !isAbsolute(xdg)) throw new DeploymentError('XDG_CONFIG_HOME must be an absolute path');
  const root = initialRoot ?? join(xdg || join(homedir(), '.config'), 'agent-memory-stack');
  if (!isAbsolute(root)) throw new DeploymentError('Native configuration root must be an absolute path');
  return resolve(root);
}
/** Validate snapshot completeness and exact source provenance before any recovery writes. */
export function validateNativeConfiguration(value: unknown, directory?: string): asserts value is NativeConfiguration {
  const saved = value as NativeConfiguration;
  if (!saved || typeof saved.root !== 'string' || !isAbsolute(saved.root) || !saved.state || saved.state.version !== 1
    || !isAbsolute(saved.state.runtime ?? '') || (directory && saved.state.runtime !== resolve(directory))
    || typeof saved.state.originsFinalized !== 'boolean' || !saved.defaults || !saved.overrides)
    throw new DeploymentError('Invalid native configuration metadata or runtime association');
  const { state, defaults, overrides } = saved;
  validateTdaiSource(state.source);
  const manifest = state.manifest;
  if (!manifest || manifest.schemaVersion !== 1 || !sameSource(manifest.source, state.source) || !manifest.templates
    || Object.keys(manifest.templates).length !== nativeFileNames.length
    || Object.keys(defaults).length !== nativeFileNames.length
    || Object.keys(overrides).some(name => !nativeFileNames.includes(name as NativeFileName))) throw new DeploymentError('Invalid native template manifest');
  for (const name of nativeFileNames) {
    const entry = manifest.templates[name];
    if (typeof defaults[name] !== 'string' || !entry || entry.sourcePath !== nativeTemplateDefinitions[name].sourcePath || entry.format !== format(name)
      || digest(defaults[name]!) !== entry.sha256) throw new DeploymentError(`defaults/${name}: template provenance mismatch; restore the original template and put changes in overrides/${name}`);
    if (overrides[name] !== undefined && typeof overrides[name] !== 'string') throw new DeploymentError(`Invalid overrides/${name}`);
  }
  if (saved.deletions !== undefined && typeof saved.deletions !== 'string') throw new DeploymentError('Invalid overrides/deletions.json');
  composeNativeConfiguration(saved);
}
export function composeNativeConfiguration(saved: NativeConfiguration): NativeServiceDocuments {
  const deletions = validateNativeDeletions(saved.deletions === undefined ? {} : parseMetadata(saved.deletions), nativeFileNames);
  return Object.fromEntries(nativeFileNames.map(name => {
    try { return [name, composeNativeDocument(saved.defaults[name]!, saved.overrides[name], format(name), deletions[name] ?? [])]; }
    catch (error) { throw new DeploymentError(`${name}: ${(error as Error).message}`); }
  }));
}
async function loadConfiguration(root: string, directory: string): Promise<NativeConfiguration | undefined> {
  const reference = await readOptional(join(directory, referenceName));
  if (reference) {
    const association = parseMetadata(reference);
    if (association.version !== 1 || association.root !== root) throw new DeploymentError('Native configuration root association changed after preparation; run ams apply again before activating');
  }
  const raw = reference ? await readOptional(join(root, stateName)) : undefined;
  if (!raw) {
    try { if ((await readdir(root)).length) throw new DeploymentError(`Native configuration directory is occupied: ${root}; restore its saved .ams/native-config.json association or select an empty native configuration directory`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (reference) throw new DeploymentError(`Missing native configuration metadata: ${root}`);
    return undefined;
  }
  const defaults: NativeServiceDocuments = {}, overrides: NativeServiceDocuments = {};
  for (const name of nativeFileNames) {
    defaults[name] = await readOptional(join(root, 'defaults', name));
    const overlay = await readOptional(join(root, 'overrides', name));
    if (overlay !== undefined) overrides[name] = overlay;
  }
  const saved: NativeConfiguration = { root, state: parseMetadata(raw), defaults, overrides, deletions: await readOptional(join(root, 'overrides/deletions.json')) };
  validateNativeConfiguration(saved, directory);
  return saved;
}
export async function readNativeConfiguration(directory: string): Promise<NativeConfiguration | undefined> {
  if (!await readOptional(join(directory, referenceName))) return undefined;
  return loadConfiguration(await nativeConfigurationRoot(directory), directory);
}
export async function readNativeDocuments(directory: string): Promise<NativeServiceDocuments | undefined> {
  const saved = await readNativeConfiguration(directory);
  return saved ? composeNativeConfiguration(saved) : undefined;
}
export async function readInstallationEnv(directory: string): Promise<Record<string, string>> {
  const env = await readEnv(join(directory, '.env'));
  const documents = await readNativeDocuments(directory);
  return documents ? normalizeNativeServiceConfigs(env, documents) : env;
}
export async function prepareNativeConfiguration(directory: string, env: Record<string, string>, options: {
  root?: string; source?: SourceLock; edits?: Record<string, string>; deferOrigins?: string[]; finalizeOrigins?: boolean;
} = {}): Promise<NativeCandidate> {
  const root = await nativeConfigurationRoot(directory, options.root);
  const previous = await loadConfiguration(root, directory);
  const source = validateTdaiSource(options.source ?? (await loadSourceLock(directory)).sources.tencent);
  const templates = previous && sameSource(previous.state.source, source)
    ? { files: previous.defaults, manifest: previous.state.manifest }
    : await getNativeTemplates(directory, source);
  const defaults = templates.files, manifest = templates.manifest;
  const overrides = { ...previous?.overrides };
  const deletions = previous?.deletions;
  if (!previous) {
    const empty = Object.fromEntries(nativeFileNames.map(name => [name, format(name) === 'env' ? '' : '{}\n']));
    // Populate the complete installation exactly once; later apply preserves user intent.
    Object.assign(overrides, seedNativeServiceConfigs(env, empty));
    const deferred = options.deferOrigins ?? [];
    if (deferred.includes('MEMORY_PROXY_PUBLIC_URL')) {
      overrides['proxy.yaml'] = updateNativeDocument(overrides['proxy.yaml']!, 'yaml', [{ path: ['injection', 'externalGatewayUrl'], value: '' }]);
      const registry = parseNativeDocument(overrides['panel-instances.json']!, 'json') as { instances: Array<Record<string, NativeValue>> };
      for (const instance of registry.instances) delete instance.proxy_endpoint;
      overrides['panel-instances.json'] = JSON.stringify(registry, null, 2) + '\n';
    }
    if (deferred.includes('KNOWLEDGE_PUBLIC_URL')) overrides['knowledge.env'] = updateNativeDocument(overrides['knowledge.env']!, 'env', [{ path: ['KNOWLEDGE_PUBLIC_BASE_URL'], value: '' }]);
  }
  if (options.edits) editNativeServiceOverrides(env, overrides, options.edits);
  const originsFinalized = previous?.state.originsFinalized ?? !options.deferOrigins?.length;
  if (options.finalizeOrigins && !originsFinalized) editNativeServiceOverrides(env, overrides, {
    MEMORY_PROXY_PUBLIC_URL: env.MEMORY_PROXY_PUBLIC_URL ?? '', KNOWLEDGE_PUBLIC_URL: env.KNOWLEDGE_PUBLIC_URL ?? '',
  }, true);
  const state: NativeState = { version: 1, runtime: resolve(directory), source, manifest, originsFinalized: originsFinalized || !!options.finalizeOrigins };
  const saved: NativeConfiguration = { root, state, defaults, overrides, deletions };
  const documents = composeNativeConfiguration(saved);
  const diagnostics = previous ? nativeFileNames.flatMap(name => nativeTemplateChanges(previous.defaults[name]!, defaults[name]!, overrides[name], format(name)).map(change => ({ file: name, ...change }))) : [];
  return { ...saved, documents, source, diagnostics, baseFingerprint: hash(previous) };
}
export async function assertNativeConfigurationCurrent(directory: string, candidate: NativeCandidate): Promise<void> {
  const previous = await loadConfiguration(candidate.root, directory);
  const saved: NativeConfiguration = { root: candidate.root, state: candidate.state, defaults: candidate.defaults, overrides: candidate.overrides, deletions: candidate.deletions };
  if (hash(previous) !== candidate.baseFingerprint && hash(previous) !== hash(saved)) throw new DeploymentError('Native configuration changed after preparation; run ams apply again before activating');
}
export async function saveNativeConfiguration(directory: string, candidate: NativeCandidate): Promise<void> {
  await assertNativeConfigurationCurrent(directory, candidate);
  const saved: NativeConfiguration = { root: candidate.root, state: candidate.state, defaults: candidate.defaults, overrides: candidate.overrides, deletions: candidate.deletions };
  validateNativeConfiguration(saved, directory);
  await protectedDirectory(candidate.root);
  await protectedDirectory(join(directory, '.ams'));
  for (const set of ['defaults', 'overrides'] as const) {
    await protectedDirectory(join(candidate.root, set));
    for (const [name, text] of Object.entries(candidate[set])) if (await readOptional(join(candidate.root, set, name)) !== text) await atomicWrite(join(candidate.root, set, name), text!);
  }
  if (candidate.deletions !== undefined && await readOptional(join(candidate.root, 'overrides/deletions.json')) !== candidate.deletions) await atomicWrite(join(candidate.root, 'overrides/deletions.json'), candidate.deletions);
  await atomicWrite(join(candidate.root, stateName), JSON.stringify(candidate.state, null, 2) + '\n');
  await atomicWrite(join(directory, referenceName), JSON.stringify({ version: 1, root: candidate.root }, null, 2) + '\n');
}
/** Native fields have a single public owner in defaults and overrides. */
export function orchestrationEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isNativeSetting(name)));
}

/** Frozen host input copied into a new container generation; running mounts never change. */
export async function stageNativeRuntime(directory: string, candidate: NativeCandidate, env: Record<string, string>): Promise<string> {
  const generation = randomUUID();
  await protectedDirectory(join(directory, '.ams'));
  await atomicWrite(join(directory, '.ams/native-runtime.json'), JSON.stringify({ version: 1, generation, documents: candidate.documents, runtimeConfigs: nativeRuntimeConfigs(env, candidate.documents), env }) + '\n');
  return generation;
}

export async function captureNativeConfiguration(directory: string): Promise<string | null> {
  const saved = await readNativeConfiguration(directory);
  return saved ? JSON.stringify(saved) : null;
}
