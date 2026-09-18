import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { listConnectionKeys, readConnectionKey, queryConnectionKeys } from '../dist/runtime/connection-keys.js';
import { runProcess } from '../dist/runtime/process.js';
import { DeploymentError } from '../dist/runtime/errors.js';

const directory = resolve('/tmp/ams-key-test');
const project = `ams-${createHash('sha256').update(directory).digest('hex').slice(0, 10)}`;
const id = 'a'.repeat(64);
const metadata = { userId: 'u1', username: 'alice', userType: 'system_admin', keyId: 'k1', name: 'First key', suffix: '1234' };
function runner(result, mutate = value => value) {
  const calls = [];
  return { calls, run: async command => {
    calls.push(command);
    if (command.args[0] === 'ps') return id;
    if (command.args[0] === 'inspect') return JSON.stringify([mutate({ Id: id, State: { Running: true }, Config: { Labels: {
      'com.docker.compose.project': project, 'com.docker.compose.service': 'core',
    } } })]);
    assert.equal(command.args[0], 'exec');
    return JSON.stringify(result);
  } };
}

test('list runs only inside the owned running Core and returns metadata without the full key', async () => {
  for (const provider of ['docker', 'podman', 'podman-compose', 'uvx-podman-compose']) {
    const fake = runner([{ ...metadata, key_value: 'must-not-be-returned' }]);
    assert.deepEqual(await listConnectionKeys(directory, provider, fake.run), [metadata]);
    assert.ok(fake.calls.every(call => call.command === (provider === 'docker' ? 'docker' : 'podman')));
    assert.ok(fake.calls[0].args.includes(`label=com.docker.compose.project=${project}`));
    const exec = fake.calls.at(-1);
    assert.deepEqual(exec.args.slice(0, 6), ['exec', '-i', id, 'node', '--input-type=module', '--eval']);
    assert.deepEqual(JSON.parse(exec.input), { operation: 'list' });
    assert.equal(exec.interactive, undefined);
  }
});

test('selected key ID goes through stdin and raw process failures cannot expose credentials', async () => {
  const keyId = "chosen-'key-id";
  const fake = runner('synthetic-connection-secret');
  assert.equal(await readConnectionKey(directory, 'podman', keyId, fake.run), 'synthetic-connection-secret');
  assert.deepEqual(JSON.parse(fake.calls.at(-1).input), { operation: 'read', keyId });
  assert.ok(!JSON.stringify(fake.calls.map(call => call.args)).includes(keyId));
  const fail = async () => { throw new Error('synthetic-connection-secret'); };
  await assert.rejects(readConnectionKey(directory, 'docker', keyId, fail), error => error instanceof DeploymentError && !error.message.includes('synthetic-connection-secret'));
});

test('stopped, mismatched or ambiguous Core containers are never queried', async () => {
  for (const mutate of [
    value => ({ ...value, Id: 'b'.repeat(64) }),
    value => ({ ...value, State: { Running: false } }),
    value => ({ ...value, Config: { Labels: { 'com.docker.compose.project': 'other', 'com.docker.compose.service': 'core' } } }),
    value => ({ ...value, Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'panel' } } }),
  ]) {
    const fake = runner([metadata], mutate);
    await assert.rejects(listConnectionKeys(directory, 'podman', fake.run), DeploymentError);
    assert.equal(fake.calls.length, 2);
  }
  for (const output of ['', `${id}\n${'b'.repeat(64)}`]) {
    let calls = 0;
    await assert.rejects(listConnectionKeys(directory, 'docker', async () => { calls++; return output; }), DeploymentError);
    assert.equal(calls, 1);
  }
});

test('malformed metadata and keys fail with safe errors', async () => {
  for (const result of [{ secret: 'hidden' }, [{ ...metadata, name: 'name\nterminal' }], [{ ...metadata, suffix: 'whole-secret' }]]) {
    await assert.rejects(listConnectionKeys(directory, 'docker', runner(result).run), DeploymentError);
  }
  for (const result of ['', ' secret ', 'secret\nline', { key: 'secret' }]) {
    await assert.rejects(readConnectionKey(directory, 'docker', 'k1', runner(result).run), DeploymentError);
  }
});

async function databaseFixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'ams-keys-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'metadata.db');
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE meta_users(user_id TEXT PRIMARY KEY, username TEXT, status TEXT, user_type TEXT);
    CREATE TABLE meta_user_keys(key_id TEXT PRIMARY KEY,user_id TEXT,key_value TEXT,name TEXT,status TEXT,expires_at TEXT);
    INSERT INTO meta_users VALUES ('u1','alice','active','system_admin'),('u2','disabled','disabled','normal');`);
  const insert = database.prepare('INSERT INTO meta_user_keys VALUES (?,?,?,?,?,?)');
  for (const [keyId, userId, status, expires] of [
    ['valid', 'u1', 'active', null], ['future', 'u1', 'active', '2999-01-01T00:00:00Z'],
    ['expired', 'u1', 'active', '2000-01-01T00:00:00Z'], ['invalid-date', 'u1', 'active', 'not-a-date'],
    ['revoked', 'u1', 'revoked', null], ['disabled-user', 'u2', 'active', null],
  ]) insert.run(keyId, userId, `synthetic-${keyId}-1234`, keyId === 'future' ? null : keyId, status, expires);
  database.close();
  return path;
}

test('SQLite list returns active unexpired metadata only and leaves database unchanged', async t => {
  const path = await databaseFixture(t);
  const before = await readFile(path);
  const keys = await queryConnectionKeys(path, { operation: 'list' });
  assert.deepEqual(keys.map(key => key.keyId), ['future', 'valid']);
  assert.ok(keys.every(key => key.suffix === '1234'));
  assert.equal(keys[0].name, '', 'unnamed keys are supported by the upstream schema');
  assert.ok(!JSON.stringify(keys).includes('synthetic-'));
  assert.deepEqual(await readFile(path), before);
});

test('SQLite read rechecks selected key status and expiration; queries are parameterized', async t => {
  const path = await databaseFixture(t);
  assert.equal(await queryConnectionKeys(path, { operation: 'read', keyId: 'valid' }), 'synthetic-valid-1234');
  for (const keyId of ['expired', 'invalid-date', 'revoked', 'disabled-user', "valid' OR 1=1 --"]) {
    await assert.rejects(queryConnectionKeys(path, { operation: 'read', keyId }), /unavailable/);
  }
  const database = new DatabaseSync(path);
  database.prepare("UPDATE meta_user_keys SET status='revoked' WHERE key_id=?").run('valid');
  database.close();
  await assert.rejects(queryConnectionKeys(path, { operation: 'read', keyId: 'valid' }), /unavailable/);
});

test('embedded helper runs in a fresh Node process without package-local imports', async t => {
  const path = await databaseFixture(t);
  const fake = runner([]);
  await listConnectionKeys(directory, 'docker', fake.run);
  const embedded = fake.calls.at(-1).args.at(-1).replace("'/data/metadata/tdai_metadata_ams/metadata.db'", JSON.stringify(path));
  const output = await runProcess({ command: process.execPath, args: ['--input-type=module', '--eval', embedded], input: '{"operation":"list"}' });
  assert.deepEqual(JSON.parse(output).map(key => key.keyId), ['future', 'valid']);
});
