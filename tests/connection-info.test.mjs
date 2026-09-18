import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeEnv } from '../dist/config/files.js';
import { showConnectionDetails } from '../dist/setup/connection-info.js';

const settings = { LLM_BASE_URL: 'https://provider.invalid/v1', LLM_API_KEY: 'provider-secret',
  MEMORY_LLM_MODEL: 'memory', KNOWLEDGE_LLM_MODEL: 'knowledge', CORE_API_KEY: 'core-secret', CLIPROXY_API_KEY: 'cpa-secret',
  MEMORY_PROXY_PORT: '28096', PANEL_PORT: '28123', MCP_PORT: '28425' };
const key = { userId: 'user-one', username: 'alice', userType: 'normal', keyId: 'key-one', name: 'agent', suffix: '1234' };
async function fixture(t, env = settings) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-connection-info-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.ams'));
  await writeFile(join(directory, '.env'), encodeEnv(env));
  await writeFile(join(directory, '.ams/runtime.json'), JSON.stringify({ provider: 'podman' }));
  const output = [], notes = [];
  return { directory, output, notes, ui: { print: text => output.push(text), note: text => notes.push(text), select: () => assert.fail('No selection needed') } };
}
const block = (fixture, name) => {
  const result = fixture.output.find(text => text.startsWith(`${name} —`));
  assert.ok(result, `Missing ${name} block`);
  return result;
};

test('each service block pairs its addresses with the matching credentials', async t => {
  const f = await fixture(t, { ...settings, REMOTE_CORE_API_KEY: 'remote-core-secret', REMOTE_MODEL_API_KEY: 'remote-model-secret',
    REMOTE_CORE_URL: 'https://remote-core.invalid', REMOTE_MODEL_BASE_URL: 'https://remote-model.invalid/v1' });
  const before = await readFile(join(f.directory, '.env'), 'utf8');
  await showConnectionDetails(f.ui, f.directory, {
    listKeys: async (directory, provider) => { assert.equal(directory, f.directory); assert.equal(provider, 'podman'); return [key]; },
    readKey: async (_directory, _provider, id) => { assert.equal(id, key.keyId); return 'synthetic-user-key-1234'; },
  });
  assert.match(block(f, 'Panel'), /Port: 28123\nLocal URL: http:\/\/localhost:28123/);
  assert.doesNotMatch(block(f, 'Panel'), /synthetic-user-key-1234/);
  assert.match(block(f, 'Panel'), /No active administrator/);
  assert.match(block(f, 'MemoryProxy'), /Port: 28096/);
  assert.match(block(f, 'MemoryProxy'), /Panel → API Keys → Client Access Endpoint/);
  assert.doesNotMatch(block(f, 'MemoryProxy'), /\/codex\/|\/claude-code\//);
  assert.match(block(f, 'MemoryProxy'), /\nsynthetic-user-key-1234\n/);
  assert.match(block(f, 'MCP'), /Local URL: http:\/\/localhost:28425\/mcp\nTransport: Streamable HTTP\nPath: \/mcp/);
  assert.match(block(f, 'MCP'), /\nsynthetic-user-key-1234\n/);
  for (const [name, url, secret] of [['Core', 'http://core:8420', 'core-secret'], ['CLIProxyAPI', 'http://cli-proxy-api:8317/v1', 'cpa-secret']]) {
    assert.ok(block(f, name).includes(url));
    assert.ok(block(f, name).includes(`\n${secret}\n`));
    assert.match(block(f, name), /Host access: not published/);
    assert.doesNotMatch(block(f, name), /Local URL:/);
  }
  assert.match(block(f, 'Internal LLM'), /API base URL: https:\/\/provider.invalid\/v1/);
  assert.match(block(f, 'Internal LLM'), /\nprovider-secret\n/);
  assert.match(block(f, 'Remote Core'), /inactive\nAPI base URL: https:\/\/remote-core.invalid/);
  assert.match(block(f, 'Remote Core'), /\nremote-core-secret\n/);
  assert.match(block(f, 'Remote model provider'), /API base URL: https:\/\/remote-model.invalid\/v1/);
  assert.match(block(f, 'Remote model provider'), /\nremote-model-secret\n/);
  assert.equal(await readFile(join(f.directory, '.env'), 'utf8'), before);
});

test('Panel login and agent keys stay next to each endpoint while Core is queried only once per key', async t => {
  const f = await fixture(t);
  const admin = { ...key, keyId: 'admin-key', name: 'Panel', userType: 'system_admin' };
  const read = []; let listed = 0;
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => { listed++; return [key, admin]; }, readKey: async (_dir, _provider, id) => {
    read.push(id); return id === admin.keyId ? 'synthetic-admin-key' : 'synthetic-user-key';
  } });
  assert.equal(listed, 1); assert.deepEqual(read, [key.keyId, admin.keyId]);
  assert.match(block(f, 'Panel'), /Administrator login key.*\nsynthetic-admin-key\n/);
  assert.doesNotMatch(block(f, 'Panel'), /synthetic-user-key/);
  for (const name of ['MemoryProxy', 'MCP']) {
    assert.match(block(f, name), /\nsynthetic-user-key\n/);
    assert.match(block(f, name), /\[administrator, full access\]:\nsynthetic-admin-key\n/);
  }
});

test('a revoked key does not hide other credentials and its failure stays in the relevant blocks', async t => {
  const f = await fixture(t);
  await showConnectionDetails(f.ui, f.directory, {
    listKeys: async () => [key, { ...key, keyId: 'revoked' }, { ...key, keyId: 'three' }],
    readKey: async (_dir, _provider, id) => { if (id === 'revoked') throw new Error('secret-bearing failure'); return `synthetic-${id}`; },
  });
  for (const name of ['MemoryProxy', 'MCP']) {
    assert.match(block(f, name), /\nsynthetic-key-one\n/);
    assert.match(block(f, name), /Key no longer available/);
    assert.match(block(f, name), /\nsynthetic-three\n/);
  }
  assert.doesNotMatch(f.output.join('\n'), /secret-bearing failure/);
});

test('absent listeners have no invented local port and retained credentials stay labeled', async t => {
  const f = await fixture(t, { AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_API_KEY: 'cpa-secret' });
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => assert.fail('No local Core') });
  assert.match(block(f, 'MCP'), /Not configured on this machine/);
  assert.match(block(f, 'MemoryProxy'), /Not configured on this machine/);
  assert.doesNotMatch(f.output.join('\n'), /Port: \d|localhost:\d/);
  assert.match(block(f, 'CLIProxyAPI'), /\ncpa-secret\n/);
});

test('lookup failures preserve endpoint/env key blocks without echoing raw errors', async t => {
  for (const phase of ['list', 'read', 'empty']) {
    const f = await fixture(t);
    const fail = () => { throw new Error('database leaked-secret'); };
    await showConnectionDetails(f.ui, f.directory, {
      listKeys: phase === 'list' ? fail : async () => phase === 'empty' ? [] : [key], readKey: fail,
    });
    assert.match(block(f, 'MCP'), /Local URL: http:\/\/localhost:28425\/mcp/);
    assert.match(block(f, 'Internal LLM'), /\nprovider-secret\n/);
    assert.match(block(f, 'Core'), /\ncore-secret\n/);
    assert.match(block(f, 'CLIProxyAPI'), /\ncpa-secret\n/);
    assert.doesNotMatch(f.output.join('\n'), /leaked-secret/);
  }
});

test('explicitly published service ports and external Panel URL stay next to their keys', async t => {
  const f = await fixture(t, { ...settings, PANEL_PUBLIC_URL: 'https://panel.invalid', CORE_SERVICE_ENABLED: 'true', CORE_SERVICE_PORT: '28420', CLIPROXY_SERVICE_ENABLED: 'true', CLIPROXY_SERVICE_PORT: '28317' });
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => [] });
  assert.match(block(f, 'Panel'), /Public URL: https:\/\/panel.invalid/);
  assert.match(block(f, 'Core'), /Local URL: http:\/\/localhost:28420/);
  assert.match(block(f, 'CLIProxyAPI'), /Local URL: http:\/\/localhost:28317\/v1/);
  for (const name of ['Core', 'CLIProxyAPI']) assert.doesNotMatch(block(f, name), /not published/);
});

test('invalid saved configuration gives guidance without accessing keys', async t => {
  const f = await fixture(t, {});
  await assert.rejects(showConnectionDetails(f.ui, f.directory, { listKeys: () => assert.fail() }), /Configure stack/);
  assert.equal(f.output.length, 0);
});
