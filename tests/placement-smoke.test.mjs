import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runProcess } from '../dist/runtime/process.js';
import { runtimeFor, integrationConfig } from '../dist/runtime/compose.js';
import { renderCompose, imageVariables } from '../dist/runtime/render-compose.js';
import { validateEnv, generateKey } from '../dist/config/settings.js';
import { resolveDeployment } from '../dist/deployment/model.js';
import { encodeEnv } from '../dist/config/files.js';

// Explicit opt-in: real isolated Compose projects, synthetic credentials only.
// Bridge attachments emulate operator-provided cross-machine private routing.
// Every consuming container retains its own project's stack network; peer
// service aliases are attached to that network, never resolved on the host.
const enabled = process.env.AMS_PLACEMENT_SMOKE === '1';
const engine = process.env.AMS_CONTAINER_ENGINE ?? 'podman';
const provider = process.env.AMS_COMPOSE_PROVIDER ?? 'uvx-podman-compose';
const manifestPath = resolve(process.env.AMS_IMAGE_MANIFEST ?? 'artifacts/images/images.json');
const command = provider === 'uvx-podman-compose' ? 'uvx' : provider;
const prefix = provider === 'uvx-podman-compose' ? ['podman-compose'] : ['docker', 'podman'].includes(provider) ? ['compose'] : [];
const exec = (args, input) => runProcess({ command: engine, args, input, label: `Placement ${args[0]} ${args[1] ?? ''}` });
const projectName = dir => `ams-${createHash('sha256').update(dir).digest('hex').slice(0, 10)}`;
const coreKey = generateKey('core');
const modelKey = generateKey('cliproxy');
const settings = (services, extra = {}) => validateEnv({
  AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: services.join(','),
  CORE_API_KEY: coreKey, CLIPROXY_API_KEY: modelKey,
  LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_API_KEY: 'synthetic-unused-provider',
  MEMORY_LLM_MODEL: 'synthetic-memory', KNOWLEDGE_LLM_MODEL: 'synthetic-wiki',
  MEMORY_PROXY_PORT: '21096', KNOWLEDGE_PORT: '21422', PANEL_PORT: '21123',
  ...extra,
});
async function createInstallation(t, suffix, manifest) {
  const dir = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), `ams-placement-${suffix}-`));
  const project = projectName(dir), network = `${project}_stack`;
  const peers = new Set(), fixtures = new Set();
  const compose = args => runProcess({ command, args: [...prefix, '--project-name', project, '--env-file', join(dir, '.ams/compose.env'), '-f', join(dir, 'compose.yaml'), ...args], cwd: dir });
  await mkdir(join(dir, '.ams'), { mode: 0o700 });
  await exec(['network', 'create', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.network=stack', network]);
  t.after(async () => {
    // Peers attached for fixture routing belong to the other test project.
    // Disconnect this private fixture network before either project tears down.
    for (const id of fixtures) await exec(['rm', '-f', id]).catch(() => {});
    for (const id of peers) {
      await exec(['network', 'disconnect', '--force', network, id]).catch(() => {});
    }
    await compose(['down']).catch(() => {});
    await exec(['network', 'rm', network]).catch(() => {});
  });
  t.diagnostic(`Isolated installation: ${dir}`);
  return { dir, project, network, compose, manifest, peers, fixtures };
}
async function configure(installation, env) {
  const plan = resolveDeployment(env);
  installation.env = env;
  const manifest = { ...installation.manifest, images: Object.fromEntries(plan.requiredImages.map(name => [name, installation.manifest.images[name]])) };
  await writeFile(join(installation.dir, '.env'), encodeEnv(env), { mode: 0o600 });
  await writeFile(join(installation.dir, 'compose.yaml'), renderCompose(env), { mode: 0o600 });
  await writeFile(join(installation.dir, '.ams/images.json'), JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(join(installation.dir, '.ams/compose.env'), [
    ...plan.requiredImages.map(name => `${imageVariables[name]}=${manifest.images[name].id}`), 'DATA_DIR=./data',
  ].join('\n') + '\n', { mode: 0o600 });
  return manifest;
}
async function containers(installation) {
  const ids = (await exec(['ps', '-aq', '--filter', `label=com.docker.compose.project=${installation.project}`])).trim().split(/\s+/).filter(Boolean);
  return ids.length ? JSON.parse(await exec(['inspect', ...ids])) : [];
}
async function container(installation, name) {
  return (await containers(installation)).find(item => item.Config.Labels['com.docker.compose.service'] === name);
}
async function attach(source, service, target, alias) {
  const item = await container(source, service);
  if (item && !item.NetworkSettings.Networks[target.network]) {
    await exec(['network', 'connect', '--alias', alias, target.network, item.Id]);
    target.peers.add(item.Id);
  }
}
const requestProgram = `let input='';for await(const chunk of process.stdin)input+=chunk;const q=JSON.parse(input);
 const r=await fetch(q.url,{method:q.method||'POST',headers:q.headers,body:q.body===undefined?undefined:JSON.stringify(q.body),redirect:'error',signal:AbortSignal.timeout(15000)});
 process.stdout.write(JSON.stringify({status:r.status,body:await r.text()}));`;
async function request(installation, url, body, headers, method = 'POST') {
  const raw = await exec(['run', '--rm', '-i', '--network', installation.network, installation.manifest.images.runtime.id, '--input-type=module', '-e', requestProgram], JSON.stringify({ url, body, headers, method }));
  const result = JSON.parse(raw);
  try { result.body = JSON.parse(result.body); } catch { /* Error bodies can be plain text. */ }
  return result;
}
const serviceHeaders = key => ({ authorization: `Bearer ${key}`, 'x-tdai-service-id': 'ams', 'content-type': 'application/json' });
async function verify(installation) {
  const config = integrationConfig(resolveDeployment(installation.env), 'verify');
  return JSON.parse(await exec(['run', '--rm', '-i', '--network', installation.network, installation.manifest.images.runtime.id, '/app/runtime/integration.js', '--stdin'], JSON.stringify(config)));
}
function assertLoopback(items) {
  for (const item of items) for (const bindings of Object.values(item.HostConfig.PortBindings ?? {})) for (const binding of bindings ?? []) assert.equal(binding.HostIp, '127.0.0.1');
}

test('standalone CLIProxyAPI starts with exactly its image and runtime, without Core initialization', { skip: !enabled, timeout: 180_000 }, async t => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const installation = await createInstallation(t, 'cli', manifest);
  const env = settings(['cli-proxy-api'], { CLIPROXY_SERVICE_ENABLED: 'true', CLIPROXY_SERVICE_PORT: '21317' });
  const selectedManifest = await configure(installation, env);
  assert.deepEqual(Object.keys(selectedManifest.images).sort(), ['cli-proxy-api', 'runtime']);
  const runtime = runtimeFor(installation.dir, provider);
  assert.deepEqual(await runtime.preflight(selectedManifest, env), { pending: [] });
  assert.deepEqual(await runtime.apply(), { pending: [] });
  const items = await containers(installation);
  assert.deepEqual(items.map(item => item.Config.Labels['com.docker.compose.service']), ['cli-proxy-api']);
  assertLoopback(items);
  assert.equal((await request(installation, 'http://cli-proxy-api:8317/v1/models', undefined, serviceHeaders(modelKey), 'GET')).status, 200);
  assert.equal((await request(installation, 'http://cli-proxy-api:8317/v1/models', undefined, {}, 'GET')).status, 401);
  assert.equal((await request(installation, 'http://cli-proxy-api:8317/v0/management/auth-files', undefined, serviceHeaders(modelKey), 'GET')).status, 404);
  t.diagnostic('CLI-only: two-image preflight, selected-only container, authenticated model API, disabled management. No provider login.');
});

test('split Knowledge/Panel staged pairing, authenticated callback, and preserved Core placement reversal', { skip: !enabled, timeout: 600_000 }, async t => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const backend = await createInstallation(t, 'backend', manifest);
  const frontend = await createInstallation(t, 'frontend', manifest);
  const admin = generateKey('admin');
  const backendEnv = settings(['core', 'knowledge'], {
    KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true', // The agent fixture calls the advertised HTTP tools port.
    CORE_SERVICE_ENABLED: 'true', CORE_SERVICE_PORT: '21420', KNOWLEDGE_SERVICE_ENABLED: 'true', KNOWLEDGE_SERVICE_PORT: '21423',
    REMOTE_PANEL_URL: 'http://remote-panel:8123',
  });
  const frontendEnv = settings(['panel', 'memory-proxy', 'cli-proxy-api'], {
    KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true', // Exercise remote HTTP tool instructions explicitly.
    REMOTE_CORE_URL: 'http://remote-core:8420', REMOTE_CORE_API_KEY: coreKey,
    KNOWLEDGE_MODE: 'remote', REMOTE_KNOWLEDGE_URL: 'http://remote-knowledge:8423', KNOWLEDGE_PUBLIC_URL: 'http://127.0.0.1:21422',
  });
  await configure(backend, backendEnv); await configure(frontend, frontendEnv);
  const wire = async () => {
    await attach(backend, 'core', frontend, 'remote-core');
    await attach(backend, 'knowledge-service', frontend, 'remote-knowledge');
    await attach(frontend, 'panel', backend, 'remote-panel');
  };
  // Route actual peers before each production integration probe. New local
  // containers are recreated by the production lifecycle, so aliases follow IDs.
  const runner = async request => {
    if (request.command === engine && request.args.includes('/app/runtime/integration.js')) await wire();
    return runProcess(request);
  };
  const backendRuntime = runtimeFor(backend.dir, provider, runner);
  const frontendRuntime = runtimeFor(frontend.dir, provider, runner);
  const before = await backendRuntime.preflight(backend.manifest, backendEnv);
  assert.ok(before.pending.includes('panel'));
  const staged = await backendRuntime.apply(admin, { allowPending: true });
  assert.ok(staged.pending.includes('panel'));
  await wire();
  const blocked = await request(backend, 'http://knowledge-service:8423/v3/wiki/list', { team_id: 'synthetic' }, serviceHeaders(coreKey));
  assert.equal(blocked.status, 503, 'Wiki is unavailable before callback owner starts');
  const frontendPreflight = await frontendRuntime.preflight(frontend.manifest, frontendEnv);
  assert.deepEqual(frontendPreflight.pending, []);
  assert.deepEqual(await frontendRuntime.apply(), { pending: [] });
  await wire();
  assert.deepEqual(await verify(backend), { pending: [] });
  assert.deepEqual(await verify(frontend), { pending: [] });
  assertLoopback(await containers(backend)); assertLoopback(await containers(frontend));
  const identity = await request(frontend, 'http://remote-core:8420/ams/identity', undefined, serviceHeaders(coreKey), 'GET');
  assert.equal(identity.status, 200);
  assert.equal((await request(frontend, 'http://remote-knowledge:8423/v3/wiki/list', { team_id: 'synthetic' }, serviceHeaders('wrong'))).status, 401);
  assert.equal((await request(frontend, 'http://remote-knowledge:8423/v3/wiki/list', { team_id: 'synthetic' }, { ...serviceHeaders(coreKey), 'x-tdai-service-id': 'wrong' })).status, 403);
  assert.equal((await request(frontend, 'http://remote-knowledge:8423/v3/admin/delete', {}, serviceHeaders(coreKey))).status, 404);
  const core = async (path, body) => {
    const result = await request(frontend, 'http://remote-core:8420' + path, body, { ...serviceHeaders(coreKey), 'x-tdai-user-key': admin });
    assert.equal(result.status, 200, path); assert.equal(result.body.code, 0, path); return result.body.data;
  };
  const auth = await core('/v3/meta/auth/verify', { user_key: admin });
  const userId = auth.user.user_id;
  const teams = await core('/v3/meta/team/list', { user_id: userId, name: 'default-team', limit: 10, offset: 0 });
  const teamId = teams.items[0].team_id;
  const created = await request(frontend, 'http://remote-knowledge:8423/v3/wiki/create', { name: `Placement ${randomUUID()}`, team_id: teamId, user_id: userId }, serviceHeaders(coreKey));
  assert.equal(created.status, 201); assert.equal(created.body.code, 0);
  const wikiId = created.body.data.wiki_id;
  const knowledge = await container(backend, 'knowledge');
  // Invoke the exact shipped callback sender with synthetic completion. There
  // is no ingest/model claim: this proves authenticated callback and entity sync.
  await exec(['exec', '-i', knowledge.Id, 'node', '--import', '/runtime/environment.mjs', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { stripTypeScriptTypes } from 'node:module';
    const source = readFileSync('/app/src/callback.ts', 'utf8');
    const anchor = 'export async function callbackTMC(';
    assert.equal(source.split(anchor).length, 2, 'single shipped callback sender');
    const start = source.indexOf(anchor), end = source.indexOf('/**', start);
    assert.ok(end > start, 'callback function boundary');
    const constants = ['TAG', 'RETRY_DELAY_MS'].map(name => {
      const matches = source.split('\\n').filter(line => line.startsWith('const ' + name + ' = '));
      assert.equal(matches.length, 1, 'single shipped constant ' + name);
      return matches[0];
    }).join('\\n');
    const code = 'import { callbackHeaders } from "file:///app/src/ams-integration.js";\\n' + constants + '\\n' + source.slice(start, end);
    const { callbackTMC } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
    let input='';for await(const c of process.stdin)input+=c;
    await callbackTMC(JSON.parse(input), {tmcCallbackUrl:process.env.TMC_CALLBACK_URL});
  `], JSON.stringify({ knowledge_id: wikiId, service_id: 'ams', type: 'wiki', status: 'ready', summary: 'Synthetic callback proves placement.', sync_error: null, timestamp: new Date().toISOString() }));
  const entity = await core('/v3/knowledge/get', { knowledge_id: wikiId });
  assert.ok(JSON.stringify(entity).includes(wikiId));
  assert.ok(JSON.stringify(entity).includes('Synthetic callback proves placement.'));
  assert.ok(JSON.stringify(entity).includes(userId), 'creator context survives callback');
  // Cross-project Core/Knowledge plus the actual frontend Proxy/Hono path.
  // Only model generation is replaced by the deterministic local HTTP fixture.
  const agents = await core('/v3/meta/agent/list', { team_id: teamId, owner_user_id: userId, limit: 10, offset: 0 });
  const agentId = agents.items[0].agent_id;
  await core('/v3/meta/asset/create', { asset_id: wikiId, team_id: teamId, asset_type: 'llm_wiki', name: 'Split fixture', owner_user_id: userId, source_type: 'manual', visibility: 'team', status: 'approved' });
  await core('/v3/meta/agent-fixed-asset/set', { agent_id: agentId, bindings: [{ asset_id: wikiId, asset_type: 'llm_wiki', created_by: userId }] });
  const fixture = `${frontend.project}-model-fixture`;
  frontend.fixtures.add(fixture);
  await exec(['run', '-d', '--name', fixture, '--network', frontend.network, '--network-alias', 'model-fixture',
    '-v', `${resolve('tests/fixtures/model-upstream.mjs')}:/fixture.mjs:ro`, manifest.images.runtime.id, '/fixture.mjs']);
  const proxyFile = join(frontend.dir, 'generated/proxy.yaml');
  const configuredProxy = JSON.parse(await readFile(proxyFile, 'utf8'));
  assert.equal(configuredProxy.tdai.endpoint, 'http://remote-core:8420');
  await writeFile(proxyFile, JSON.stringify({ ...configuredProxy, upstream: { url: 'http://model-fixture:8090/v1', apiKey: 'synthetic-fixture-key' } }));
  await frontend.compose(['restart', 'memory-proxy']);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const eventually = async (read, accept, label, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    do { const value = await read(); if (accept(value)) return value; await pause(500); } while (Date.now() < deadline);
    assert.fail(`${label} did not become ready`);
  };
  const proxyOrigin = 'http://127.0.0.1:21096';
  await eventually(async () => { try { return (await fetch(proxyOrigin + '/health')).ok; } catch { return false; } }, Boolean, 'Proxy health');
  const events = async () => (await request(frontend, 'http://model-fixture:8090/events', undefined, {}, 'GET')).body;
  const sessionId = `placement-${randomUUID()}`;
  const userText = 'AMS_L0_SMOKE: remember that the synthetic release color is violet.';
  const assistantText = 'AMS synthetic assistant response, persisted as L0.';
  const model = 'ams-unlisted-split-model';
  const headers = { authorization: `Bearer ${admin}`, 'content-type': 'application/json', 'x-team-id': teamId, 'x-agent-id': agentId, 'session-id': sessionId };
  const body = { model, stream: true, instructions: 'Synthetic split deployment check.', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: userText }] }] };
  const response = await fetch(proxyOrigin + '/codex/ams/v1/responses', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(assistantText));
  const captured = await events();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].taskHeader, null);
  assert.equal(captured[0].body.model, model);
  const instructions = captured[0].body.instructions;
  assert.ok(instructions.includes('<knowledge_tools>'));
  assert.ok(instructions.includes('http://127.0.0.1:21422/v3'));
  assert.ok(instructions.includes('${AMS_USER_KEY:?AMS_USER_KEY is required}'));
  assert.ok(!JSON.stringify(captured).includes(admin));
  assert.ok(!instructions.includes('remote-knowledge') && !instructions.includes('/v3/v3'));
  const toolResponse = await fetch('http://127.0.0.1:21422/v3/tools/list', {
    method: 'POST', headers: serviceHeaders(admin), body: JSON.stringify({ knowledge_id: wikiId }), signal: AbortSignal.timeout(30_000),
  });
  assert.equal(toolResponse.status, 200, 'advertised tool origin is reachable from the agent environment');
  const tools = await toolResponse.json();
  assert.ok(JSON.stringify(tools).includes('wiki'), 'advertised endpoint returns Knowledge tools');
  const l0 = await eventually(() => core('/v3/conversation/query', { team_id: teamId, user_id: userId, agent_id: agentId, session_id: sessionId, limit: 100, offset: 0 }),
    data => data.messages?.some(item => item.role.toLowerCase() === 'user' && item.content.includes(userText)) && data.messages?.some(item => item.role.toLowerCase() === 'assistant' && item.content.includes(assistantText)), 'Split Core L0', 45_000);
  assert.ok(l0.messages.every(item => item.user_id === userId && item.agent_id === agentId));
  const controller = new AbortController();
  const beforeCancel = (await events()).length;
  const cancel = await fetch(proxyOrigin + '/codex/ams/v1/responses', { method: 'POST', headers: { ...headers, 'session-id': `cancel-${randomUUID()}` },
    body: JSON.stringify({ ...body, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AMS_CANCEL_SMOKE' }] }] }), signal: controller.signal });
  assert.equal(cancel.status, 200);
  const reader = cancel.body.getReader();
  assert.equal((await reader.read()).done, false);
  controller.abort(); await reader.cancel().catch(() => {});
  await eventually(events, list => list.length === beforeCancel + 1 && list.at(-1).closed && !list.at(-1).completed, 'Split SSE cancellation', 10_000);
  await pause(500); assert.equal((await events()).length, beforeCancel + 1, 'No accepted request retry after cancellation');
  await exec(['rm', '-f', fixture]); frontend.fixtures.delete(fixture);

  const callbackURL = 'http://panel:8123/api/v1/knowledge/status-callback';
  const callbackBody = { knowledge_id: wikiId, service_id: 'ams', type: 'wiki', status: 'ready' };
  assert.equal((await request(frontend, callbackURL, callbackBody, {})).status, 401);
  assert.equal((await request(frontend, callbackURL, callbackBody, { ...serviceHeaders(coreKey), 'x-ams-core-id': 'wrong', 'x-ams-knowledge-id': 'wrong' })).status, 409);

  // Disable local Panel Knowledge integration, making the authenticated peer
  // advertise a mismatched tuple. No fake identity endpoint is substituted.
  await configure(frontend, settings(['panel', 'memory-proxy', 'cli-proxy-api'], { REMOTE_CORE_URL: 'http://remote-core:8420', REMOTE_CORE_API_KEY: coreKey }));
  await frontendRuntime.apply(); await wire();
  const mismatch = await verify(backend);
  assert.match(mismatch.error, /pairing/);
  assert.equal((await request(backend, 'http://knowledge-service:8423/v3/wiki/list', { team_id: teamId }, serviceHeaders(coreKey))).status, 409);
  await configure(frontend, frontendEnv); await frontendRuntime.apply(); await wire();
  assert.deepEqual(await verify(backend), { pending: [] });

  // Keep the backend Core running as the remote replacement. The frontend
  // first owns its own Core, then uses that remote Core, then reuses local data.
  await configure(frontend, settings(['cli-proxy-api'])); await frontendRuntime.apply();
  await configure(backend, settings(['core'])); await backendRuntime.apply(); await wire();
  const ownKey = generateKey('core'), ownAdmin = generateKey('admin');
  const ownEnv = settings(['core', 'memory-proxy', 'cli-proxy-api'], { CORE_API_KEY: ownKey });
  await configure(frontend, ownEnv); await frontendRuntime.apply(ownAdmin);
  const ownIdentity = await request(frontend, 'http://core:8420/ams/identity', undefined, serviceHeaders(ownKey), 'GET');
  assert.equal(ownIdentity.status, 200);
  assert.notEqual(ownIdentity.body.coreId, identity.body.coreId);
  const ownAuth = await request(frontend, 'http://core:8420/v3/meta/auth/verify', { user_key: ownAdmin }, serviceHeaders(ownKey));
  const remoteEnv = settings(['memory-proxy', 'cli-proxy-api'], {
    CORE_API_KEY: ownKey, REMOTE_CORE_URL: 'http://remote-core:8420', REMOTE_CORE_API_KEY: coreKey,
  });
  await configure(frontend, remoteEnv); await frontendRuntime.apply(); await wire();
  assert.equal(await container(frontend, 'core'), undefined);
  const remoteIdentity = await request(frontend, 'http://remote-core:8420/ams/identity', undefined, serviceHeaders(coreKey), 'GET');
  assert.equal(remoteIdentity.body.coreId, identity.body.coreId);
  const proxyConfig = JSON.parse(await readFile(join(frontend.dir, 'generated/proxy.yaml'), 'utf8'));
  assert.equal(proxyConfig.tdai.endpoint, 'http://remote-core:8420');
  assert.equal(proxyConfig.tdai.apiKey, coreKey);
  await configure(frontend, ownEnv); await frontendRuntime.apply();
  const restored = await request(frontend, 'http://core:8420/ams/identity', undefined, serviceHeaders(ownKey), 'GET');
  assert.equal(restored.body.coreId, ownIdentity.body.coreId);
  const restoredAuth = await request(frontend, 'http://core:8420/v3/meta/auth/verify', { user_key: ownAdmin }, serviceHeaders(ownKey));
  assert.equal(restoredAuth.body.data.user.user_id, ownAuth.body.data.user.user_id);
  const untouched = await request(backend, 'http://core:8420/ams/identity', undefined, serviceHeaders(coreKey), 'GET');
  assert.equal(untouched.body.coreId, identity.body.coreId, 'remote project identity is never replaced');
  assert.equal((await container(backend, 'core')).State.Status, 'running', 'other project stays running');
  assert.equal((await containers(frontend)).filter(item => item.Config.Labels['com.docker.compose.service'] === 'cli-proxy-api').length, 1);
  await writeFile(join(backend.dir, 'placement-validation.json'), JSON.stringify({ stagedStart: true, splitPairing: true, splitFinalToolOrigins: true, splitL0: true, splitSseCancellation: true, callbackEntitySync: true, mismatchRejected: true, localRemoteLocalCoreIdentity: true, providerLogin: 'not tested', semanticWikiIngest: 'not tested', automaticDataMigration: false }, null, 2));
});
