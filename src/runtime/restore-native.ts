import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicWrite } from '../config/files.js';
import { validateNativeConfiguration, validateNativeReference } from '../config/native-state.js';
import { validateDeploymentImages } from '../build/images.js';
import { validateTdaiSource } from '../build/sources.js';
import { nativeFileNames } from '../config/native-templates.js';

// This is the input record consumed by server-settings.restoreSnapshotInputs.
// Read the restored snapshot itself: the current record may describe an abandoned update.
const inputNames = ['.env', '.ams/runtime.json', '.ams/tdai-source.json', '.ams/images.json', '.ams/native-config.json', '.ams/native-runtime.json', '.ams/native-backup.json'];
async function optional(path: string): Promise<string | undefined> {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Snapshot requires regular files'); return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Finish an explicit settings restore after the matching runtime snapshot was copied.
 * Application databases are deliberately outside this operation. */
export async function restoreNativeSnapshot(directory: string, snapshot: string): Promise<void> {
  directory = resolve(directory); snapshot = resolve(snapshot);
  for (const name of ['.ams/tdai-source.json', '.ams/images.json']) {
    if (await optional(join(directory, name)) !== await optional(join(snapshot, name))) throw new Error('Restore matching source and image records from this snapshot before restoring native configuration');
  }
  const raw = await optional(join(snapshot, '.ams/native-backup.json'));
  const restoredInputs = Object.fromEntries(await Promise.all(inputNames.map(async name => [name, await optional(join(snapshot, name)) ?? null])));
  if (restoredInputs['.env'] === null) throw new Error('Settings snapshot is missing .env');
  if (!raw) throw new Error('Settings snapshot is missing native configuration');
  const finishRestore = async () => {
    await mkdir(join(directory, '.ams'), { recursive: true, mode: 0o700 });
    // Keep the active native runtime pointer paired with the restored Compose generation.
    const runtime = restoredInputs['.ams/native-runtime.json'];
    if (runtime === null) await rm(join(directory, '.ams/native-runtime.json'), { force: true });
    else await atomicWrite(join(directory, '.ams/native-runtime.json'), runtime);
    await atomicWrite(join(directory, '.ams/last-applied-inputs.json'), JSON.stringify(restoredInputs) + '\n');
    for (const name of ['pending-tdai-source.json', 'pending-images.json', 'before-save.json', 'apply-pending']) await rm(join(directory, '.ams', name), { recursive: true, force: true });
  };
  let saved: unknown;
  let reference: unknown;
  try { saved = JSON.parse(raw); reference = JSON.parse(restoredInputs['.ams/native-config.json'] ?? 'null'); } catch { throw new Error('Invalid native configuration snapshot'); }
  validateNativeReference(reference);
  const backup = saved as { root?: unknown };
  if (!backup || typeof backup !== 'object' || reference.root !== backup.root) throw new Error('Invalid native configuration snapshot reference');
  const configuration = { ...backup, originsFinalized: reference.originsFinalized };
  validateNativeConfiguration(configuration);
  const source = restoredInputs['.ams/tdai-source.json'];
  const images = restoredInputs['.ams/images.json'];
  if (!source || !images) throw new Error('Native configuration snapshot is missing source or image records');
  validateTdaiSource(JSON.parse(source));
  validateDeploymentImages(JSON.parse(images));

  // Validate all destinations before replacing either visible set.
  const assertDirectory = async (path: string): Promise<boolean> => {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Native restore paths must be directories');
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  };
  await assertDirectory(configuration.root);
  for (const set of ['defaults', 'overrides']) {
    await assertDirectory(join(configuration.root, set));
    for (const name of [...nativeFileNames, ...(set === 'overrides' ? ['deletions.json'] : [])]) await optional(join(configuration.root, set, name));
  }
  await mkdir(configuration.root, { recursive: true, mode: 0o700 });
  await chmod(configuration.root, 0o700);
  for (const set of ['defaults', 'overrides'] as const) {
    await mkdir(join(configuration.root, set), { recursive: true, mode: 0o700 });
    await chmod(join(configuration.root, set), 0o700);
    for (const name of nativeFileNames) {
      const text = configuration[set][name];
      if (text === undefined) await rm(join(configuration.root, set, name), { force: true });
      else await atomicWrite(join(configuration.root, set, name), text);
    }
  }
  if (configuration.deletions === undefined) await rm(join(configuration.root, 'overrides/deletions.json'), { force: true });
  else await atomicWrite(join(configuration.root, 'overrides/deletions.json'), configuration.deletions);
  await mkdir(join(directory, '.ams'), { recursive: true, mode: 0o700 });
  await atomicWrite(join(directory, '.ams/native-config.json'), restoredInputs['.ams/native-config.json']!);
  await finishRestore();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node dist/runtime/restore-native.js <runtime-directory> <snapshot-directory>');
    await restoreNativeSnapshot(process.argv[2], process.argv[3]);
    console.log('Native configuration restored. Apply the matching runtime configuration to recreate containers.');
  } catch { console.error('Native restore failed. Check the matching snapshot, source/image records, configuration ownership and file permissions.'); process.exitCode = 1; }
}
