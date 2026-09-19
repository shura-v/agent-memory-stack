import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshotSettings } from '../dist/runtime/snapshot.js';
import { captureInputs, preserveInputs, recordAppliedInputs, restoreSnapshotInputs } from '../dist/setup/server-settings.js';

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

test('TDAI update snapshot retains the applied source while the desired source changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-source-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.ams'));
  const pin = '.ams/tdai-source.json';
  await writeFile(join(dir, pin), 'original source');
  await recordAppliedInputs(dir, await captureInputs(dir));
  await preserveInputs(dir);
  await writeFile(join(dir, pin), 'updated source');
  await snapshotSettings(dir);
  await restoreSnapshotInputs(dir);
  const previous = join(dir, '.ams/previous-settings', pin);
  assert.equal(await readFile(previous, 'utf8'), 'original source');
  assert.equal(await readFile(join(dir, pin), 'utf8'), 'updated source');
  await writeFile(join(dir, pin), 'retry source');
  await snapshotSettings(dir);
  await restoreSnapshotInputs(dir);
  assert.equal(await readFile(previous, 'utf8'), 'original source');
});

test('incomplete applied input records fail before changing the settings snapshot', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ams-incomplete-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.ams'));
  await writeFile(join(dir, '.ams/last-applied-inputs.json'), JSON.stringify({ '.env': null, '.ams/runtime.json': null }));
  await writeFile(join(dir, '.ams/tdai-source.json'), 'new source');
  await snapshotSettings(dir);
  await assert.rejects(restoreSnapshotInputs(dir), /Invalid saved input snapshot/);
  assert.equal(await readFile(join(dir, '.ams/previous-settings/.ams/tdai-source.json'), 'utf8'), 'new source');
  assert.equal(await readFile(join(dir, '.ams/tdai-source.json'), 'utf8'), 'new source');
});
