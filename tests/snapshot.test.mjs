import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotSettings } from '../dist/runtime/snapshot.js';

test('configuration snapshot preserves the pre-apply bytes across failed retries and excludes data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'generated'));
  await mkdir(join(dir, 'data/cli-proxy-api'), { recursive: true });
  await writeFile(join(dir, '.env'), 'CORE_API_KEY=original\n');
  await writeFile(join(dir, 'generated/core.json'), '{"key":"original"}\n');
  await writeFile(join(dir, 'data/cli-proxy-api/account.json'), 'private account');
  await snapshotSettings(dir);
  const previous = join(dir, '.ams/previous-settings');
  assert.equal(await readFile(join(previous, '.env'), 'utf8'), 'CORE_API_KEY=original\n');
  assert.equal((await stat(join(previous, '.env'))).mode & 0o777, 0o600);
  assert.equal((await stat(previous)).mode & 0o777, 0o700);
  await assert.rejects(stat(join(previous, 'data')), { code: 'ENOENT' });
  await writeFile(join(dir, '.env'), 'CORE_API_KEY=new\n');
  await snapshotSettings(dir);
  assert.equal(await readFile(join(previous, '.env'), 'utf8'), 'CORE_API_KEY=original\n');
  await rm(join(dir, '.ams/apply-pending'));
  await snapshotSettings(dir);
  assert.equal(await readFile(join(previous, '.env'), 'utf8'), 'CORE_API_KEY=new\n');
});

test('snapshot rejects redirected generated files before marking an apply in progress', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-snapshot-link-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'generated'));
  await writeFile(join(dir, 'private'), 'outside configuration');
  await symlink(join(dir, 'private'), join(dir, 'generated/redirect'));
  await assert.rejects(snapshotSettings(dir), /regular files/);
  await assert.rejects(stat(join(dir, '.ams/apply-pending')), { code: 'ENOENT' });
  assert.equal(await readFile(join(dir, 'private'), 'utf8'), 'outside configuration');
});
