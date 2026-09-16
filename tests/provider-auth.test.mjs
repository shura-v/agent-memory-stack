import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasProviderAuthorization } from '../dist/runtime/provider-auth.js';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'ams-provider-auth-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('saved authorization matches the chosen provider independently of model availability', async t => {
  const path = await directory(t);
  await writeFile(join(path, 'account.json'), JSON.stringify({ type: 'codex', access_token: 'synthetic-token' }));
  assert.equal(await hasProviderAuthorization(path, 'codex'), true);
  assert.equal(await hasProviderAuthorization(path, 'claude'), false);
  await writeFile(join(path, 'account.json'), JSON.stringify({ type: 'claude', access_token: 'synthetic-token' }));
  assert.equal(await hasProviderAuthorization(path, 'codex'), false);
  assert.equal(await hasProviderAuthorization(path, 'claude'), true);
});

test('nested account files retain authorization through refresh credentials', async t => {
  const path = await directory(t);
  await mkdir(join(path, 'nested'));
  for (const type of ['codex', 'claude']) {
    await writeFile(join(path, 'nested', `${type}.JSON`), JSON.stringify({ type, refresh_token: 'synthetic-refresh', access_token: '', expired: '2000-01-01T00:00:00Z' }));
    assert.equal(await hasProviderAuthorization(path, type), true);
  }
});

test('Claude recognizes its upstream legacy refresh token field', async t => {
  const path = await directory(t);
  await writeFile(join(path, 'account.json'), JSON.stringify({ type: 'claude', refreshToken: 'synthetic-refresh' }));
  assert.equal(await hasProviderAuthorization(path, 'claude'), true);
  await writeFile(join(path, 'account.json'), JSON.stringify({ type: 'codex', refreshToken: 'synthetic-refresh' }));
  assert.equal(await hasProviderAuthorization(path, 'codex'), false);
});

test('disabled, malformed, empty and unrelated records do not satisfy authorization', async t => {
  const path = await directory(t);
  const records = [
    '', '{', 'null', '[]', '12',
    { type: 'codex', disabled: true, access_token: 'synthetic-token' },
    { type: 'codex', access_token: ' ', refresh_token: '' },
    { type: 'codex', access_token: 123, refresh_token: false },
    { type: 'other', access_token: 'synthetic-token' },
    { type: 'codex', id_token: 'synthetic-identity-only' },
  ];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    await writeFile(join(path, `${index}.json`), typeof record === 'string' ? record : JSON.stringify(record));
  }
  await writeFile(join(path, 'ignored.txt'), JSON.stringify({ type: 'codex', access_token: 'synthetic-token' }));
  assert.equal(await hasProviderAuthorization(path, 'codex'), false);
  assert.equal(await hasProviderAuthorization(join(path, 'missing'), 'codex'), false);
});

test('filesystem failures and oversized records produce sanitized errors', async t => {
  const path = await directory(t);
  const file = join(path, 'private-path.json');
  await writeFile(file, 'private-token');
  await assert.rejects(hasProviderAuthorization(file, 'codex'), { message: 'Cannot inspect saved CLIProxyAPI authorization.' });
  await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(hasProviderAuthorization(path, 'codex'), { message: 'Cannot inspect saved CLIProxyAPI authorization.' });
});

test('standalone check prints only a boolean and never account contents or error paths', async t => {
  const path = await directory(t);
  await writeFile(join(path, 'account.json'), JSON.stringify({ type: 'codex', access_token: 'private-token' }));
  for (const [provider, expected] of [['codex', 'true\n'], ['claude', 'false\n']]) {
    const result = spawnSync(process.execPath, ['dist/runtime/provider-auth.js', path, provider], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
  }
  const failure = spawnSync(process.execPath, ['dist/runtime/provider-auth.js', path, 'invalid'], { encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.equal(failure.stderr, 'Cannot inspect saved CLIProxyAPI authorization.\n');
});
