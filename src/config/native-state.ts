import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { atomicWrite, readEnv } from './files.js';
import { loadSourceLock, validateTdaiSource, type SourceLock } from '../build/sources.js';
import { getNativeTemplates, nativeFileNames, type NativeFileName } from './native-templates.js';
import { composeNativeDocument, nativeTemplateChanges, validateNativeDeletions, parseNativeDocument, updateNativeDocument, type NativeFormat, type NativeValue } from './native-documents.js';
import { seedNativeServiceConfigs, editNativeServiceOverrides, normalizeNativeServiceConfigs, nativeRuntimeConfigs, type NativeServiceDocuments } from './native-services.js';
import { DeploymentError } from '../runtime/errors.js';
import { isNativeSetting } from './settings.js';

export interface NativeReference { version: 1; root: string; originsFinalized: boolean }
export interface NativeBackup { root: string; defaults: NativeServiceDocuments; overrides: NativeServiceDocuments; deletions?: string }
export interface NativeConfiguration extends NativeBackup { originsFinalized: boolean }
export interface NativeCandidate extends NativeConfiguration { documents: NativeServiceDocuments; baseFingerprint: string; source: SourceLock; diagnostics: Array<{ file: string; path: string; reason: string }> }
const referenceName = '.ams/native-config.json';
const format = (name: string): NativeFormat => name.endsWith('.yaml') ? 'yaml' : name.endsWith('.env') ? 'env' : 'json';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry) ?? 'undefined').digest('hex');
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
    validateNativeReference(reference);
    return reference.root;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (!initialRoot && xdg && !isAbsolute(xdg)) throw new DeploymentError('XDG_CONFIG_HOME must be an absolute path');
  const root = initialRoot ?? join(xdg || join(homedir(), '.config'), 'agent-memory-stack');
  if (!isAbsolute(root)) throw new DeploymentError('Native configuration root must be an absolute path');
  return resolve(root);
}
export function validateNativeReference(value: unknown, root?: string): asserts value is NativeReference {
  const reference = value as NativeReference;
  if (!reference || typeof reference !== 'object' || reference.version !== 1 || typeof reference.root !== 'string' || !isAbsolute(reference.root)
    || typeof reference.originsFinalized !== 'boolean' || (root && reference.root !== root)) {
    throw new DeploymentError('Invalid .ams/native-config.json; restore the native configuration reference');
  }
}
/** Validate structural configuration before composition or recovery writes. */
export function validateNativeConfiguration(value: unknown): asserts value is NativeConfiguration {
  const saved = value as NativeConfiguration;
  if (!saved || typeof saved !== 'object' || typeof saved.root !== 'string' || !isAbsolute(saved.root) || typeof saved.originsFinalized !== 'boolean'
    || !saved.defaults || !saved.overrides || Object.keys(saved.defaults).length !== nativeFileNames.length
    || Object.keys(saved.overrides).some(name => !nativeFileNames.includes(name as NativeFileName))) {
    throw new DeploymentError('Invalid native configuration');
  }
  const { defaults, overrides } = saved;
  for (const name of nativeFileNames) {
    if (typeof defaults[name] !== 'string') throw new DeploymentError(`Missing native configuration: defaults/${name}`);
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
  let originsFinalized = true;
  if (reference) {
    const association = parseMetadata(reference);
    validateNativeReference(association, root);
    originsFinalized = association.originsFinalized;
  }
  if (!reference) {
    try {
      if (!(await readdir(root)).some(name => name === 'defaults' || name === 'overrides')) return undefined;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  const defaults: NativeServiceDocuments = {}, overrides: NativeServiceDocuments = {};
  for (const name of nativeFileNames) {
    defaults[name] = await readOptional(join(root, 'defaults', name));
    const overlay = await readOptional(join(root, 'overrides', name));
    if (overlay !== undefined) overrides[name] = overlay;
  }
  const saved: NativeConfiguration = { root, originsFinalized, defaults, overrides, deletions: await readOptional(join(root, 'overrides/deletions.json')) };
  validateNativeConfiguration(saved);
  return saved;
}
export async function readNativeConfiguration(directory: string, initialRoot?: string): Promise<NativeConfiguration | undefined> {
  const root = await nativeConfigurationRoot(directory, initialRoot);
  return loadConfiguration(root, directory);
}
export async function readNativeDocuments(directory: string, initialRoot?: string): Promise<NativeServiceDocuments | undefined> {
  const saved = await readNativeConfiguration(directory, initialRoot);
  return saved ? composeNativeConfiguration(saved) : undefined;
}
export async function readInstallationEnv(directory: string, initialRoot?: string): Promise<Record<string, string>> {
  const env = await readEnv(join(directory, '.env'));
  const documents = await readNativeDocuments(directory, initialRoot);
  return documents ? normalizeNativeServiceConfigs(env, documents) : env;
}
export async function prepareNativeConfiguration(directory: string, env: Record<string, string>, options: {
  root?: string; source?: SourceLock; edits?: Record<string, string>; deferOrigins?: string[]; finalizeOrigins?: boolean;
} = {}): Promise<NativeCandidate> {
  const root = await nativeConfigurationRoot(directory, options.root);
  const previous = await loadConfiguration(root, directory);
  const source = validateTdaiSource(options.source ?? (await loadSourceLock(directory)).sources.tencent);
  const defaults = previous && options.source === undefined ? previous.defaults : (await getNativeTemplates(directory, source)).files;
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
  const originsFinalized = previous?.originsFinalized ?? !options.deferOrigins?.length;
  if (options.finalizeOrigins && !originsFinalized) editNativeServiceOverrides(env, overrides, {
    MEMORY_PROXY_PUBLIC_URL: env.MEMORY_PROXY_PUBLIC_URL ?? '', KNOWLEDGE_PUBLIC_URL: env.KNOWLEDGE_PUBLIC_URL ?? '',
  }, true);
  const saved: NativeConfiguration = { root, originsFinalized: originsFinalized || !!options.finalizeOrigins, defaults, overrides, deletions };
  const documents = composeNativeConfiguration(saved);
  const diagnostics = previous ? nativeFileNames.flatMap(name => nativeTemplateChanges(previous.defaults[name]!, defaults[name]!, overrides[name], format(name)).map(change => ({ file: name, ...change }))) : [];
  return { ...saved, documents, source, diagnostics, baseFingerprint: hash(previous) };
}
export async function assertNativeConfigurationCurrent(directory: string, candidate: NativeCandidate): Promise<void> {
  const previous = await loadConfiguration(candidate.root, directory);
  const saved: NativeConfiguration = { root: candidate.root, originsFinalized: candidate.originsFinalized, defaults: candidate.defaults, overrides: candidate.overrides, deletions: candidate.deletions };
  if (hash(previous) !== candidate.baseFingerprint && hash(previous) !== hash(saved)) throw new DeploymentError('Native configuration changed after preparation; run ams apply again before activating');
}
export async function saveNativeConfiguration(directory: string, candidate: NativeCandidate): Promise<void> {
  await assertNativeConfigurationCurrent(directory, candidate);
  const saved: NativeConfiguration = { root: candidate.root, originsFinalized: candidate.originsFinalized, defaults: candidate.defaults, overrides: candidate.overrides, deletions: candidate.deletions };
  validateNativeConfiguration(saved);
  await protectedDirectory(candidate.root);
  await protectedDirectory(join(directory, '.ams'));
  for (const set of ['defaults', 'overrides'] as const) {
    await protectedDirectory(join(candidate.root, set));
    for (const [name, text] of Object.entries(candidate[set])) if (await readOptional(join(candidate.root, set, name)) !== text) await atomicWrite(join(candidate.root, set, name), text!);
  }
  if (candidate.deletions !== undefined && await readOptional(join(candidate.root, 'overrides/deletions.json')) !== candidate.deletions) await atomicWrite(join(candidate.root, 'overrides/deletions.json'), candidate.deletions);
  await atomicWrite(join(directory, referenceName), JSON.stringify({ version: 1, root: candidate.root, originsFinalized: candidate.originsFinalized }, null, 2) + '\n');
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

export async function captureNativeConfiguration(directory: string, initialRoot?: string): Promise<string | null> {
  const saved = await readNativeConfiguration(directory, initialRoot);
  if (!saved) return null;
  const backup: NativeBackup = { root: saved.root, defaults: saved.defaults, overrides: saved.overrides, deletions: saved.deletions };
  return JSON.stringify(backup);
}
