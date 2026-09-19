import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { captureNativeConfiguration, readNativeConfiguration } from '../config/native-state.js';
import { atomicWrite } from '../config/files.js';

const inputPaths = ['.env', '.ams/runtime.json', '.ams/tdai-source.json', '.ams/images.json', '.ams/native-config.json', '.ams/native-runtime.json', '.ams/native-backup.json'] as const;
type Inputs = Record<typeof inputPaths[number], string | null>;

export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function readInput(path: string): Promise<string | null> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Saved configuration must use regular files');
    return await readFile(path, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function captureInputs(directory: string, nativeRoot?: string): Promise<Inputs> {
  const native = await captureNativeConfiguration(directory, nativeRoot);
  const inputs = Object.fromEntries(await Promise.all(inputPaths.map(async path => [path, path === '.ams/native-backup.json' ? native : await readInput(join(directory, path))]))) as Inputs;
  if (native && inputs['.ams/native-config.json'] === null) {
    const configuration = await readNativeConfiguration(directory, nativeRoot);
    inputs['.ams/native-config.json'] = JSON.stringify({ version: 1, root: configuration!.root, originsFinalized: configuration!.originsFinalized }, null, 2) + '\n';
  }
  return inputs;
}

/** Preserve editable inputs without reading generated files owned by service UID 10001. */
export async function preserveInputs(directory: string, nativeRoot?: string): Promise<void> {
  const path = join(directory, '.ams/before-save.json');
  if (await exists(path)) return;
  const contents = JSON.stringify(await captureInputs(directory, nativeRoot));
  await mkdir(join(directory, '.ams'), { recursive: true, mode: 0o700 });
  await atomicWrite(path, contents + '\n');
}

/** The privileged snapshot assigns these files back to the installation owner. */
export async function restoreSnapshotInputs(directory: string): Promise<void> {
  const raw = await readInput(join(directory, '.ams/last-applied-inputs.json'))
    ?? await readInput(join(directory, '.ams/before-save.json'));
  if (raw === null) return;
  const inputs = JSON.parse(raw) as Inputs;
  if (!inputs || inputPaths.some(path => inputs[path] !== null && typeof inputs[path] !== 'string')) {
    throw new Error('Invalid saved input snapshot; existing settings were not replaced');
  }
  for (const path of inputPaths) {
    const destination = join(directory, '.ams/previous-settings', path);
    if (inputs[path] == null) await rm(destination, { force: true });
    else {
      await mkdir(join(directory, '.ams/previous-settings', path === '.env' ? '' : '.ams'), { recursive: true, mode: 0o700 });
      await atomicWrite(destination, inputs[path]);
    }
  }
}

export async function recordAppliedInputs(directory: string, inputs: Inputs): Promise<void> {
  await atomicWrite(join(directory, '.ams/last-applied-inputs.json'), JSON.stringify(inputs) + '\n');
  await rm(join(directory, '.ams/before-save.json'), { force: true });
}
