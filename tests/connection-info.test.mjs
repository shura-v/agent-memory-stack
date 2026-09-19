import { installNativeSourceFixture } from './fixtures/native-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeEnv } from '../dist/config/files.js';
import { showConnectionDetails } from '../dist/setup/connection-info.js';
import { prepareNativeConfiguration, saveNativeConfiguration } from '../dist/config/native-state.js';
import { updateNativeDocument } from '../dist/config/native-documents.js';

const settings = { LLM_BASE_URL: 'https://provider.invalid/v1', LLM_API_KEY: 'provider-secret',
  MEMORY_LLM_MODEL: 'memory', KNOWLEDGE_LLM_MODEL: 'knowledge', CORE_API_KEY: 'core-secret', CLIPROXY_API_KEY: 'cpa-secret',
  MEMORY_PROXY_PORT: '28096', PANEL_PORT: '28123', MCP_PORT: '28425' };
const key = { userId: 'user-one', username: 'alice', userType: 'normal', keyId: 'key-one', name: 'agent', suffix: '1234' };
async function fixture(t, env = settings) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-connection-info-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(directory, 'xdg');
  t.after(() => { if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousXdg; });
  await mkdir(join(directory, '.ams'));
  await writeFile(join(directory, '.env'), encodeEnv(env));
  await writeFile(join(directory, '.ams/runtime.json'), JSON.stringify({ provider: 'podman' }));
  const output = [], notes = [];
  return { directory, output, notes, ui: { print: text => output.push(text), note: text => notes.push(text), select: () => assert.fail('No selection needed') } };
}
const block = (fixture, name) => {
  const result = fixture.output.find(text => text.startsWith(`${name}\n`));
  assert.ok(result, `Missing ${name} block`);
  return result;
};

test('each service block pairs its addresses with the matching credentials', async t => {
  const f = await fixture(t);
  const before = await readFile(join(f.directory, '.env'), 'utf8');
  await showConnectionDetails(f.ui, f.directory, {
    listKeys: async (directory, provider) => { assert.equal(directory, f.directory); assert.equal(provider, 'podman'); return [key]; },
    readKey: async (_directory, _provider, id) => { assert.equal(id, key.keyId); return 'synthetic-user-key-1234'; },
  });
  assert.match(block(f, 'Panel — web interface'), /Port: 28123\nLocal URL: http:\/\/localhost:28123/);
  assert.doesNotMatch(block(f, 'Panel — web interface'), /synthetic-user-key-1234/);
  assert.match(block(f, 'Panel — web interface'), /No active administrator/);
  assert.match(block(f, 'MemoryProxy — API for your agent with memory'), /Port: 28096/);
  assert.match(block(f, 'MemoryProxy — API for your agent with memory'), /Panel → API Keys → Client Access Endpoint/);
  assert.doesNotMatch(block(f, 'MemoryProxy — API for your agent with memory'), /\/codex\/|\/claude-code\//);
  assert.match(block(f, 'MemoryProxy — API for your agent with memory'), /\nsynthetic-user-key-1234\n/);
  assert.match(block(f, 'MCP — Knowledge tools for your agent'), /Local URL: http:\/\/localhost:28425\/mcp\nTransport: Streamable HTTP\nPath: \/mcp/);
  assert.match(block(f, 'MCP — Knowledge tools for your agent'), /\nsynthetic-user-key-1234\n/);
  for (const [name, url, secret] of [['Core — internal memory service', 'http://core:8420', 'core-secret'], ['CLIProxyAPI — model provider access', 'http://cli-proxy-api:8317/v1', 'cpa-secret']]) {
    assert.ok(block(f, name).includes(url));
    assert.ok(block(f, name).includes(`\n${secret}\n`));
    assert.match(block(f, name), /Host access: not published/);
    assert.doesNotMatch(block(f, name), /Local URL:/);
  }
  assert.match(block(f, 'Internal LLM — memory and Knowledge processing'), /API base URL: https:\/\/provider.invalid\/v1/);
  assert.match(block(f, 'Internal LLM — memory and Knowledge processing'), /\nprovider-secret\n/);
  assert.deepEqual(f.output.slice(-4), [
    '========================================\nAgent connections\n========================================\n',
    block(f, 'MemoryProxy — API for your agent with memory'),
    block(f, 'MCP — Knowledge tools for your agent'),
    'Agent setup guides: https://github.com/shura-v/agent-memory-stack/blob/main/docs/agent-profiles/README.md\n',
  ]);
  assert.match(f.output.at(-5), /^Local or remote\?/);
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
  assert.match(block(f, 'Panel — web interface'), /Administrator login key.*\nsynthetic-admin-key\n/);
  assert.doesNotMatch(block(f, 'Panel — web interface'), /synthetic-user-key/);
  for (const name of ['MemoryProxy — API for your agent with memory', 'MCP — Knowledge tools for your agent']) {
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
  for (const name of ['MemoryProxy — API for your agent with memory', 'MCP — Knowledge tools for your agent']) {
    assert.match(block(f, name), /\nsynthetic-key-one\n/);
    assert.match(block(f, name), /Key no longer available/);
    assert.match(block(f, name), /\nsynthetic-three\n/);
  }
  assert.doesNotMatch(f.output.join('\n'), /secret-bearing failure/);
});

test('lookup failures preserve endpoint/env key blocks without echoing raw errors', async t => {
  for (const phase of ['list', 'read', 'empty']) {
    const f = await fixture(t);
    const fail = () => { throw new Error('database leaked-secret'); };
    await showConnectionDetails(f.ui, f.directory, {
      listKeys: phase === 'list' ? fail : async () => phase === 'empty' ? [] : [key], readKey: fail,
    });
    assert.match(block(f, 'MCP — Knowledge tools for your agent'), /Local URL: http:\/\/localhost:28425\/mcp/);
    assert.match(block(f, 'Internal LLM — memory and Knowledge processing'), /\nprovider-secret\n/);
    assert.match(block(f, 'Core — internal memory service'), /\ncore-secret\n/);
    assert.match(block(f, 'CLIProxyAPI — model provider access'), /\ncpa-secret\n/);
    assert.doesNotMatch(f.output.join('\n'), /leaked-secret/);
  }
});

test('explicitly published service ports and external Panel URL stay next to their keys', async t => {
  const f = await fixture(t, { ...settings, PANEL_PUBLIC_URL: 'https://panel.invalid', CORE_SERVICE_ENABLED: 'true', CORE_SERVICE_PORT: '28420', CLIPROXY_SERVICE_ENABLED: 'true', CLIPROXY_SERVICE_PORT: '28317' });
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => [] });
  assert.match(block(f, 'Panel — web interface'), /Public URL: https:\/\/panel.invalid/);
  assert.match(block(f, 'Core — internal memory service'), /Local URL: http:\/\/localhost:28420/);
  assert.match(block(f, 'CLIProxyAPI — model provider access'), /Local URL: http:\/\/localhost:28317\/v1/);
  for (const name of ['Core — internal memory service', 'CLIProxyAPI — model provider access']) assert.doesNotMatch(block(f, name), /not published/);
});

test('invalid saved configuration gives guidance without accessing keys', async t => {
  const f = await fixture(t, {});
  await assert.rejects(showConnectionDetails(f.ui, f.directory, { listKeys: () => assert.fail() }), /Configure stack/);
  assert.equal(f.output.length, 0);
});

test('shared internal routing displays its effective key and labels retained external settings inactive', async t => {
  const f = await fixture(t, { ...settings, INTERNAL_LLM_SOURCE: 'cliproxy', MEMORY_LLM_MODEL: '' });
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => [] });
  const internal = block(f, 'Internal LLM — memory and Knowledge processing');
  assert.match(internal, /Source: this stack's CLIProxyAPI/);
  assert.match(internal, /API base URL: http:\/\/cli-proxy-api:8317\/v1/);
  assert.match(internal, /API key \(CLIPROXY_API_KEY\):\ncpa-secret/);
  assert.match(internal, /Core model: \n/);
  assert.doesNotMatch(internal, /select during Apply/);
  assert.doesNotMatch(internal, /provider-secret/);
  const external = block(f, 'External internal-model API — saved credentials, inactive');
  assert.match(external, /saved credentials, inactive/);
  assert.match(external, /API base URL: https:\/\/provider.invalid\/v1/);
  assert.match(external, /\nprovider-secret\n/);
});

test('connection details read each native model configuration and label the dedicated proxy admin key', async t => {
  const f = await fixture(t);
  const root = join(f.directory, 'native');
  await installNativeSourceFixture(f.directory);
  const candidate = await prepareNativeConfiguration(f.directory, settings, { root });
  await saveNativeConfiguration(f.directory, candidate);
  for (const [file, format, changes] of [
    ['core.yaml', 'yaml', [
      { path: ['llm', 'baseUrl'], value: 'https://core-model.synthetic.invalid/v1' },
      { path: ['llm', 'model'], value: 'native-core-model' }, { path: ['llm', 'apiKey'], value: 'native-core-provider-key' },
    ]],
    ['knowledge.env', 'env', [
      { path: ['LLM_BASE_URL'], value: 'https://knowledge-model.synthetic.invalid/v1' },
      { path: ['LLM_MODEL'], value: 'native-knowledge-model' }, { path: ['LLM_API_KEY'], value: 'native-knowledge-provider-key' },
    ]],
    ['proxy.yaml', 'yaml', [{ path: ['admin', 'apiKey'], value: 'synthetic-dedicated-proxy-admin-key' }]],
  ]) await writeFile(join(root, 'overrides', file), updateNativeDocument(await readFile(join(root, 'overrides', file), 'utf8'), format, changes));
  const beforeEnv = await readFile(join(f.directory, '.env'), 'utf8');
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => [key], readKey: async () => 'synthetic-agent-user-key' });
  for (const service of ['Core', 'Knowledge']) {
    const output = f.output.find(text => text.startsWith(`${service} — native internal LLM`));
    assert.ok(output, `${service} has a distinct native internal model block`);
    const name = service.toLowerCase();
    assert.ok(output.includes(`API base URL: https://${name}-model.synthetic.invalid/v1`));
    assert.ok(output.includes(`Model: native-${name}-model`));
    assert.ok(output.includes(`\nnative-${name}-provider-key\n`));
  }
  const admin = f.output.find(text => text.startsWith('MemoryProxy — native administration'));
  assert.match(admin, /Administrative key \([^\n]*overrides\/proxy.yaml admin.apiKey\):\nsynthetic-dedicated-proxy-admin-key\n/);
  assert.doesNotMatch(block(f, 'Panel — web interface'), /synthetic-dedicated-proxy-admin-key/);
  assert.doesNotMatch(block(f, 'MemoryProxy — API for your agent with memory'), /synthetic-dedicated-proxy-admin-key/);
  assert.match(block(f, 'MemoryProxy — API for your agent with memory'), /synthetic-agent-user-key/);
  const footer = f.output.slice(-4).join('\n');
  assert.match(footer, /^=+\nAgent connections\n=+\n/);
  assert.doesNotMatch(footer, /synthetic-dedicated-proxy-admin-key|core-secret|native-core-provider-key|native-knowledge-provider-key|native administration/);
  assert.match(footer, /Agent setup guides: https:\/\/github.com\/shura-v\/agent-memory-stack\/blob\/main\/docs\/agent-profiles\/README.md/);
  assert.doesNotMatch(f.output.join('\n'), /\nprovider-secret\n/);
  assert.equal(await readFile(join(f.directory, '.env'), 'utf8'), beforeEnv);

  const knowledge = f.output.find(text => text.startsWith('Knowledge connections'));
  assert.match(knowledge, /Panel callback URL: http:\/\/panel:8123/);
  assert.doesNotMatch(knowledge, /AMS_CORE_|Service key/);
  for (const name of ['Panel connections', 'MemoryProxy connections']) {
    const connection = f.output.find(text => text.startsWith(name));
    assert.match(connection, /Core API: http:\/\/core:8420/);
    assert.match(connection, /core-secret/);
    assert.match(connection, /overrides/);
  }
});

test('connection details identify inherited defaults separately from overrides and never mutate either set', async t => {
  const f = await fixture(t, settings);
  const root = join(f.directory, 'native');
  await installNativeSourceFixture(f.directory);
  const candidate = await prepareNativeConfiguration(f.directory, settings, { root });
  await saveNativeConfiguration(f.directory, candidate);
  const coreOverride = join(root, 'overrides/core.yaml');
  await writeFile(coreOverride, updateNativeDocument(await readFile(coreOverride, 'utf8'), 'yaml', [{ path: ['llm', 'model'], delete: true }]));
  const { captureNativeConfiguration } = await import('../dist/config/native-state.js');
  const before = await captureNativeConfiguration(f.directory);
  await showConnectionDetails(f.ui, f.directory, { listKeys: async () => [] });
  const core = f.output.find(text => text.startsWith('Core — native internal LLM'));
  assert.ok(core.includes(`${join(root, 'defaults/core.yaml')} llm.model`));
  assert.ok(core.includes(`${join(root, 'overrides/core.yaml')} llm.baseUrl`));
  assert.ok(core.includes(`${join(root, 'overrides/core.yaml')} llm.apiKey`));
  assert.equal(await captureNativeConfiguration(f.directory), before);
  assert.equal(f.notes.length, 0, 'secrets belong only on the explicitly requested details screen');
  assert.match(f.output.join('\n'), /Knowledge — native internal LLM/);
  assert.match(f.output.join('\n'), /MemoryProxy — native administration/);
});
