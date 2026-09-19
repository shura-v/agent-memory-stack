import { chmod, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicWrite } from '../config/files.js';
import { validateNativeConfiguration } from '../config/native-state.js';
import { validateDeploymentImages } from '../build/images.js';
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
  let reference;
  try { saved = JSON.parse(raw); reference = JSON.parse(restoredInputs['.ams/native-config.json'] ?? 'null'); } catch { throw new Error('Invalid native configuration snapshot'); }
  validateNativeConfiguration(saved, directory);
  if (reference?.version !== 1 || reference.root !== saved.root) throw new Error('Invalid native configuration snapshot reference');
  const source = restoredInputs['.ams/tdai-source.json'];
  const images = restoredInputs['.ams/images.json'];
  if (!source || !images) throw new Error('Native configuration snapshot is missing source or image records');
  const selected = JSON.parse(source);
  if (['revision', 'url', 'sha256'].some(key => selected[key] !== saved.state.source[key as keyof typeof saved.state.source])) throw new Error('Native configuration snapshot does not match its source record');
  validateDeploymentImages(JSON.parse(images));

  // Validate all destinations before replacing either visible set. An occupied
  // root must already be associated with this runtime; snapshot ownership alone
  // does not authorize adopting unrelated files.
  const assertDirectory = async (path: string): Promise<boolean> => {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Native restore paths must be directories');
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  };
  if (await assertDirectory(saved.root)) {
    const existing = await optional(join(saved.root, '.ams-state.json'));
    if ((await readdir(saved.root)).length) {
      const activeReference = await optional(join(directory, '.ams/native-config.json'));
      if (!existing || JSON.parse(existing).runtime !== directory || !activeReference || JSON.parse(activeReference).root !== saved.root) throw new Error('Native restore root is occupied or unassociated with this installation');
    }
  }
  for (const set of ['defaults', 'overrides']) {
    await assertDirectory(join(saved.root, set));
    for (const name of [...nativeFileNames, ...(set === 'overrides' ? ['deletions.json'] : [])]) await optional(join(saved.root, set, name));
  }
  await mkdir(saved.root, { recursive: true, mode: 0o700 });
  await chmod(saved.root, 0o700);
  for (const set of ['defaults', 'overrides'] as const) {
    await mkdir(join(saved.root, set), { recursive: true, mode: 0o700 });
    await chmod(join(saved.root, set), 0o700);
    for (const name of nativeFileNames) {
      const text = saved[set][name];
      if (text === undefined) await rm(join(saved.root, set, name), { force: true });
      else await atomicWrite(join(saved.root, set, name), text);
    }
  }
  if (saved.deletions === undefined) await rm(join(saved.root, 'overrides/deletions.json'), { force: true });
  else await atomicWrite(join(saved.root, 'overrides/deletions.json'), saved.deletions);
  await atomicWrite(join(saved.root, '.ams-state.json'), JSON.stringify(saved.state, null, 2) + '\n');
  await mkdir(join(directory, '.ams'), { recursive: true, mode: 0o700 });
  await atomicWrite(join(directory, '.ams/native-config.json'), JSON.stringify({ version: 1, root: saved.root }, null, 2) + '\n');
  await finishRestore();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node dist/runtime/restore-native.js <runtime-directory> <snapshot-directory>');
    await restoreNativeSnapshot(process.argv[2], process.argv[3]);
    console.log('Native configuration restored. Apply the matching runtime configuration to recreate containers.');
  } catch { console.error('Native restore failed. Check the matching snapshot, source/image records, configuration ownership and file permissions.'); process.exitCode = 1; }
}
