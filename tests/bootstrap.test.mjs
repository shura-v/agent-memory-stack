import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { initialize, BootstrapRequiredError } from '../dist/runtime/bootstrap.js';

const KEY = `sk-ams-admin-${'a'.repeat(64)}`;
const USER = { user_id: 'user-1', username: 'admin', user_type: 'system_admin', status: 'active' };
const TEAM = { team_id: 'team-1', name: 'default-team', owner_user_id: USER.user_id, status: 'active' };
const AGENT = { agent_id: 'agent-1', name: 'default-agent-admin', owner_user_id: USER.user_id, team_id: TEAM.team_id, status: 'active', visibility: 'team' };
const response = (data, status = 200) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, data }), { status });
const result = (created) => ({ initialized: true, created, userId: USER.user_id, teamId: TEAM.team_id, agentId: AGENT.agent_id });

function fixture(options = {}) {
  const state = {
    key: options.existing ? KEY : null, user: { ...USER, ...options.user },
    team: options.team === undefined ? { ...TEAM } : options.team,
    agent: options.agent === undefined ? { ...AGENT } : options.agent, calls: [],
  };
  const fetchImpl = async (url, request) => {
    const endpoint = url.pathname;
    const body = JSON.parse(request.body);
    state.calls.push({ endpoint, body });
    assert.equal(request.headers.authorization, options.withoutServiceKey ? undefined : 'Bearer gateway-key');
    assert.equal(request.headers['x-tdai-service-id'], 'ams');
    assert.equal(request.redirect, 'error');
    if (endpoint === '/v3/internal/meta/user/list-by-instance') {
      const matches = state.key && (!body.user_type || body.user_type === state.user.user_type) && (!body.status || body.status === state.user.status);
      return response({ items: matches ? [state.user] : [], total: matches ? 1 : 0 });
    }
    if (endpoint === '/v3/internal/meta/user/init-admin') {
      if (options.conflict) { state.key = options.conflict; return response(null, 409); }
      assert.equal(state.key, null, 'never initialize a known populated database');
      state.key = body.user_key;
      return response({ user_id: USER.user_id, user_key: body.user_key });
    }
    if (endpoint === '/v3/meta/auth/verify') return response({ valid: body.user_key === state.key, user: body.user_key === state.key ? state.user : null });
    assert.equal(request.headers['x-tdai-user-key'], state.key);
    if (endpoint === '/v3/meta/team/list') return response({ items: state.team ? [state.team] : [], total: state.team ? 1 : 0 });
    if (endpoint === '/v3/meta/agent/list') return response({ items: state.agent ? [state.agent] : [], total: state.agent ? 1 : 0 });
    if (endpoint === '/v3/meta/team/create') { state.team = { ...body, team_id: TEAM.team_id }; return response(state.team); }
    if (endpoint === '/v3/meta/agent/create') { state.agent = { ...body, agent_id: AGENT.agent_id }; return response(state.agent); }
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  return { state, fetchImpl, run: (overrides = {}) => initialize({ coreApiKey: 'gateway-key', mode: 'initialize', adminKey: KEY, fetchImpl, ...overrides }) };
}

test('first initialization preserves the generated handoff key and returns only identifiers', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), result(true));
  assert.equal(f.state.key, KEY);
  assert.equal(f.state.calls[0].endpoint, '/v3/internal/meta/user/list-by-instance');
});

test('custom keys retain quotes, backslash and dollar characters without a prefix', async () => {
  const f = fixture();
  const custom = 'custom-"quote"-\\-\'-$literal';
  assert.deepEqual(await f.run({ adminKey: custom }), result(true));
  assert.equal(f.state.key, custom);
});

test('short custom keys accepted by upstream remain unchanged', async () => {
  const f = fixture();
  await f.run({ adminKey: 'x' });
  assert.equal(f.state.key, 'x');
});

for (const adminKey of [undefined, '', ' ', ' padded', 'line\nbreak', 'nul\0inside']) {
  test(`invalid transient key (${String(adminKey).length} characters) fails before HTTP`, async () => {
    const f = fixture();
    await assert.rejects(f.run({ adminKey }), /nonempty admin key/);
    assert.equal(f.state.calls.length, 0);
  });
}

test('existing setup verifies supplied key without another init mutation', async () => {
  const f = fixture({ existing: true });
  assert.deepEqual(await f.run(), result(false));
  assert.ok(!f.state.calls.some((call) => call.endpoint.endsWith('init-admin')));
  assert.equal(f.state.calls[1].endpoint, '/v3/meta/auth/verify');
});

test('409 initialization race verifies the key before repairing entities', async () => {
  const f = fixture({ conflict: KEY, team: null, agent: null });
  assert.deepEqual(await f.run(), result(false));
  const routes = f.state.calls.map((call) => call.endpoint);
  assert.ok(routes.indexOf('/v3/meta/auth/verify') < routes.indexOf('/v3/meta/team/create'));
});

test('409 with another key stops without entity reads or mutations', async () => {
  const f = fixture({ conflict: 'different-key' });
  await assert.rejects(f.run(), /does not authenticate/);
  assert.ok(!f.state.calls.some((call) => /\/(team|agent)\//.test(call.endpoint)));
});

test('ordinary check needs no admin credential and performs one filtered read', async () => {
  const f = fixture({ existing: true });
  assert.deepEqual(await f.run({ mode: 'check', adminKey: undefined }), { initialized: true, created: false, userId: USER.user_id });
  assert.deepEqual(f.state.calls, [{ endpoint: '/v3/internal/meta/user/list-by-instance', body: { user_type: 'system_admin', status: 'active', limit: 1, offset: 0 } }]);
});

for (const options of [{}, { existing: true, user: { user_type: 'normal' } }, { existing: true, user: { status: 'inactive' } }]) {
  test(`check requires setup when no active administrator exists: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run({ mode: 'check', adminKey: undefined }), (error) => error instanceof BootstrapRequiredError && error.code === 'SETUP_REQUIRED');
    assert.equal(f.state.calls.length, 1);
  });
}

test('normal-user credentials cannot repair administrator defaults', async () => {
  const f = fixture({ existing: true, user: { user_type: 'normal' }, team: null });
  await assert.rejects(f.run(), /does not authenticate/);
  assert.equal(f.state.team, null);
});

test('an active key belonging to an inactive administrator cannot repair defaults', async () => {
  const f = fixture({ existing: true, user: { status: 'inactive' }, team: null, agent: null });
  await assert.rejects(f.run(), /inactive or unavailable administrator/);
  assert.ok(!f.state.calls.some((call) => /\/(team|agent)\//.test(call.endpoint)));
  assert.deepEqual(f.state.calls.at(-1).body, {
    user_ids: [USER.user_id], user_type: 'system_admin', status: 'active', limit: 1, offset: 0,
  });
});

test('partial initialization repairs and rechecks missing default entities', async () => {
  const f = fixture({ team: null, agent: null });
  assert.deepEqual(await f.run(), result(true));
  assert.equal(f.state.calls.filter((call) => call.endpoint === '/v3/meta/team/list').length, 2);
  assert.equal(f.state.calls.filter((call) => call.endpoint === '/v3/meta/agent/list').length, 2);
});

test('retry after administrator creation repairs missing defaults with the same credential', async () => {
  for (const team of [null, { ...TEAM }]) {
    const f = fixture({ existing: true, team, agent: null });
    assert.deepEqual(await f.run(), result(false));
    assert.equal(f.state.key, KEY);
    assert.ok(!f.state.calls.some(call => call.endpoint.endsWith('init-admin')));
    const endpoints = f.state.calls.map(call => call.endpoint);
    assert.ok(endpoints.indexOf('/v3/meta/auth/verify') < endpoints.indexOf('/v3/meta/agent/create'));
    assert.equal(endpoints.filter(endpoint => endpoint === '/v3/meta/team/create').length, team ? 0 : 1);
    assert.equal(f.state.team.team_id, TEAM.team_id);
    assert.equal(f.state.agent.agent_id, AGENT.agent_id);
  }
});

test('inactive defaults cause an actionable failure', async () => {
  const f = fixture({ team: { ...TEAM, status: 'inactive' } });
  await assert.rejects(f.run(), /Default team.*Repair/);
  assert.ok(!f.state.calls.some((call) => call.endpoint.endsWith('/create')));
});

test('HTTP, malformed JSON and network errors cannot expose secrets', async () => {
  const f = fixture();
  for (const fetchImpl of [async () => { throw new Error(KEY); }, async () => response({ secret: KEY }, 403), async () => new Response(`malformed ${KEY}`)]) {
    await assert.rejects(f.run({ fetchImpl }), (error) => !error.message.includes(KEY));
  }
});

async function cliFixture(t, options = {}) {
  const f = fixture(options);
  const directory = await mkdtemp(join(tmpdir(), 'ams-bootstrap-'));
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const result = await f.fetchImpl(new URL(req.url, 'http://core:8420'), {
        headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), redirect: 'error',
      });
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(await result.text());
    } catch { res.writeHead(500); res.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const envFile = join(directory, 'bootstrap.json');
  await writeFile(envFile, JSON.stringify({ CORE_API_KEY: 'gateway-key', CORE_URL: `http://127.0.0.1:${server.address().port}`, SERVICE_ID: 'ams' }), { mode: 0o600 });
  const command = new URL('../dist/runtime/bootstrap.js', import.meta.url);
  const run = (mode, input = '', extra = [], overrides = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command.pathname, mode, ...extra], {
      cwd: directory, env: { PATH: process.env.PATH, AMS_ENV_FILE: envFile, ...overrides }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
  return { ...f, directory, envFile, run };
}

test('CLI consumes stdin key, prints only IDs and creates no credential file', async (t) => {
  const f = await cliFixture(t);
  const execution = await f.run('initialize', JSON.stringify({ adminKey: KEY }));
  assert.equal(execution.code, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout), result(true));
  assert.ok(!`${execution.stdout}${execution.stderr}`.includes(KEY));
  assert.deepEqual(await readdir(f.directory), ['bootstrap.json']);
  assert.ok(!(await readFile(f.envFile, 'utf8')).includes(KEY));
});

test('CLI check needs no stdin, and empty state reports setup required', async (t) => {
  const f = await cliFixture(t, { existing: true });
  assert.equal((await f.run('check')).code, 0);
  f.state.key = null;
  const execution = await f.run('check');
  assert.equal(execution.code, 2);
  assert.match(execution.stderr, /Run ams/);
});

test('cancelled, malformed or oversized stdin does not create users or leak input', async (t) => {
  const f = await cliFixture(t);
  for (const input of ['', `{${KEY}`, JSON.stringify({ adminKey: KEY, unexpected: KEY }), JSON.stringify({ adminKey: KEY.repeat(300) })]) {
    const execution = await f.run('initialize', input);
    assert.equal(execution.code, 1);
    assert.ok(!`${execution.stdout}${execution.stderr}`.includes(KEY));
    assert.equal(f.state.key, null);
  }
  assert.equal(f.state.calls.length, 0);
});

test('CLI rejects credential arguments and ignores admin credentials from environment', async (t) => {
  const f = await cliFixture(t);
  const argument = await f.run('initialize', '', [KEY]);
  assert.equal(argument.code, 1);
  assert.ok(!argument.stderr.includes(KEY));
  const environment = await f.run('initialize', '', [], { ADMIN_USER_KEY: KEY });
  assert.equal(environment.code, 1);
  assert.ok(!environment.stderr.includes(KEY));
  assert.equal(f.state.calls.length, 0);
});

test('CLI environment load failure is sanitized before initialization', async (t) => {
  const f = await cliFixture(t);
  await writeFile(f.envFile, `invalid JSON ${KEY}`);
  const execution = await f.run('initialize', JSON.stringify({ adminKey: KEY }));
  assert.equal(execution.code, 1);
  assert.ok(!execution.stderr.includes(KEY));
  assert.equal(f.state.calls.length, 0);
});

test('initialization and readiness work without a Core service key while checking the user key', async () => {
  const f = fixture({ withoutServiceKey: true });
  assert.deepEqual(await f.run({ coreApiKey: undefined }), result(true));
  assert.equal(f.state.calls.find(call => call.endpoint.endsWith('/auth/verify')).body.user_key, KEY);
  assert.deepEqual(await f.run({ coreApiKey: '', mode: 'check', adminKey: undefined }), { initialized: true, created: false, userId: USER.user_id });
});
