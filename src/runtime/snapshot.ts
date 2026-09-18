import { chmod, chown, copyFile, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Snapshot only settings, never application data, OAuth files or transient stdin. */
export async function snapshotSettings(directory: string): Promise<void> {
  const marker = join(directory, '.ams/apply-pending');
  try { await lstat(marker); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const owner = await lstat(directory);
  const destination = join(directory, '.ams/previous-settings');
  await rm(destination, { recursive: true, force: true });
  const makeDirectory = async (path: string) => {
    await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700);
    if (process.getuid?.() === 0) await chown(path, owner.uid, owner.gid);
  };
  await makeDirectory(join(directory, '.ams'));
  await makeDirectory(destination);
  const paths = ['.env', 'compose.yaml', '.ams/images.json', '.ams/compose.env', '.ams/runtime.json', '.ams/applied.json', '.ams/network.json', '.ams/tdai-source.json'];
  try {
    const generated = join(directory, 'generated');
    if (!(await lstat(generated)).isDirectory() || (await lstat(generated)).isSymbolicLink()) throw new Error('Generated configuration must be a directory');
    for (const file of await readdir(generated)) paths.push(`generated/${file}`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const relative of paths) {
    const source = join(directory, relative);
    let entry;
    try { entry = await lstat(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Settings snapshot requires regular files');
    const target = join(destination, relative);
    await makeDirectory(dirname(target)); await copyFile(source, target); await chmod(target, 0o600);
    if (process.getuid?.() === 0) await chown(target, owner.uid, owner.gid);
  }
  await writeFile(marker, 'Configuration apply in progress; previous-settings is preserved until success.\n', { mode: 0o600 });
  if (process.getuid?.() === 0) await chown(marker, owner.uid, owner.gid);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await snapshotSettings(resolve(process.argv[2] || '/state')); }
  catch { console.error('Settings snapshot failed; existing settings were not replaced.'); process.exitCode = 1; }
}
