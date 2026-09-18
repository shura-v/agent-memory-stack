import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setupServer } from '../dist/setup/server.js';
import { createTargetStore } from '../dist/setup/targets.js';
import { runtimeFor } from '../dist/runtime/compose.js';
import { runProcess } from '../dist/runtime/process.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';

// Opt-in actual Core + Proxy/Hono integration. The sole LLM upstream is an
// isolated synthetic HTTP container. Never logs in, loads accounts or changes
// the caller's deployment. Run only after other heavy Compose tests stop.
const enabled = process.env.AMS_MODEL_SMOKE === '1';
const provider = process.env.AMS_COMPOSE_PROVIDER ?? 'uvx-podman-compose';
const engine = process.env.AMS_CONTAINER_ENGINE ?? 'podman';
const manifestPath = resolve(process.env.AMS_IMAGE_MANIFEST ?? 'artifacts/images/images.json');
const fixturePath = resolve('tests/fixtures/model-upstream.mjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const model = 'ams-unlisted-model-smoke-2026';
const userText = 'AMS_L0_SMOKE: remember that the synthetic release color is violet.';
const assistantText = 'AMS synthetic assistant response, persisted as L0.';

async function eventually(read, accept, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (accept(value)) return value;
    await sleep(500);
  } while (Date.now() < deadline);
  assert.fail(`${label} did not become ready within ${timeout}ms`);
}

test('actual model instructions, no-task L0 and SSE cancellation', { skip: !enabled, timeout: 360_000 }, async t => {
  const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ams-model-'));
  const project = `ams-${createHash('sha256').update(directory).digest('hex').slice(0, 10)}`;
  const fixtureName = `${project}-model-fixture`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mkdir(join(directory, '.ams'));
  await writeFile(join(directory, '.ams/images.json'), JSON.stringify(manifest));
  let admin; // Captured from setup; remains in memory and the authoritative test database only.
  const answers = { directory, provider,
    MEMORY_PROXY_PUBLIC_URL: 'http://127.0.0.1:19096', KNOWLEDGE_PUBLIC_URL: 'http://127.0.0.1:19422',
    PANEL_PUBLIC_URL: 'http://127.0.0.1:19123', MEMORY_PROXY_PORT: '19096', KNOWLEDGE_PORT: '19422', PANEL_PORT: '19123', MCP_PORT: '19425',
    LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_API_KEY: 'synthetic-unused-provider-key',
    MEMORY_LLM_MODEL: 'memory-fixture', KNOWLEDGE_LLM_MODEL: 'wiki-fixture' };
  // Network settings now come from .env; this fixture explicitly exercises direct HTTP injection.
  await writeFile(join(directory, '.env'), encodeEnv({
    ...Object.fromEntries(Object.entries(answers).filter(([name]) => /_PORT$|_PUBLIC_URL$/.test(name))),
    KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true',
  }), { mode: 0o600 });
  const command = provider === 'uvx-podman-compose' ? 'uvx' : provider;
  const prefix = provider === 'uvx-podman-compose' ? ['podman-compose'] : ['docker', 'podman'].includes(provider) ? ['compose'] : [];
  const compose = args => runProcess({ command, args: [...prefix, '--project-name', project,
    '--env-file', join(directory, '.ams/compose.env'), '-f', join(directory, 'compose.yaml'), ...args], cwd: directory });
  let fixtureStarted = false;
  t.after(async () => {
    if (fixtureStarted) await runProcess({ command: engine, args: ['rm', '-f', fixtureName] });
    await compose(['down']); // Only this hash-derived project; preserves failure evidence on disk.
  });
  t.diagnostic(`Isolated model smoke installation: ${directory}`);
  const ui = {
    async multiselect(_id, _message, _choices, initial) { return initial; },
    async text(q) { const value = answers[q.id] ?? q.initial; assert.equal(typeof value, 'string', q.id); return value; },
    async select(id, _message, _choices, initial) { return answers[id] ?? initial; },
    async confirm(id, _message, initial) { return id === 'apply' ? true : initial; },
    note() {}, async handoff(key) { admin = key; },
  };
  // Use production lifecycle/bootstrap; this synthetic inference test does not exercise account login.
  await setupServer(ui, { runtime: (...args) => ({ ...runtimeFor(...args), hasProviderAuthorization: async () => true }), targets: createTargetStore(join(directory, 'targets.json')) });
  assert.ok(typeof admin === 'string' && /^sk-ams-admin-[a-f0-9]{64}$/.test(admin), 'setup hands off the generated administrator key before authentication');
  const env = await readEnv(join(directory, '.env'));
  const proxyOrigin = `http://127.0.0.1:${env.MEMORY_PROXY_PORT}`;
  const panelOrigin = `http://127.0.0.1:${env.PANEL_PORT}`;
  const proxyFile = join(directory, 'generated/proxy.yaml');
  const originalConfig = JSON.parse(await readFile(proxyFile, 'utf8'));
  assert.equal(originalConfig.auth.url, 'http://core:8420', 'auth loader appends its own verify route');
  assert.deepEqual(originalConfig.creditPricing.models, []);
  assert.equal(originalConfig.creditReport.url, '');
  assert.deepEqual(originalConfig.rateLimit, { qpm: 0, tpm: 0 });

  await runProcess({ command: engine, args: ['run', '-d', '--name', fixtureName, '--network', `${project}_stack`,
    '--network-alias', 'model-fixture', '--label', `ams.model-smoke.project=${project}`,
    '-v', `${fixturePath}:/fixture.mjs:ro`, manifest.images.runtime.id, '/fixture.mjs'] });
  fixtureStarted = true;
  // Send all synthetic credentials over stdin; none enter argv, logs or files.
  const requestScript = `let input='';for await(const c of process.stdin)input+=c;
    const q=JSON.parse(input);const r=await fetch(q.url,{method:q.method||'POST',headers:q.headers,
    body:q.body===undefined?undefined:JSON.stringify(q.body),signal:AbortSignal.timeout(15000)});
    process.stdout.write(JSON.stringify({status:r.status,text:await r.text()}));`;
  async function internalRequest(url, body, headers, method = 'POST') {
    const raw = await runProcess({ command: engine, args: ['exec', '-i', fixtureName, 'node', '--input-type=module', '-e', requestScript],
      input: JSON.stringify({ url, body, headers, method }) });
    const result = JSON.parse(raw);
    assert.equal(result.status, 200, `${new URL(url).pathname} HTTP status`);
    return JSON.parse(result.text);
  }
  const coreHeaders = { authorization: `Bearer ${env.CORE_API_KEY}`, 'x-tdai-service-id': 'ams',
    'x-tdai-user-key': admin, 'content-type': 'application/json' };
  async function core(path, body) {
    const result = await internalRequest(`http://core:8420${path}`, body, coreHeaders);
    assert.equal(result.code, 0, `${path} Core envelope code`);
    return result.data;
  }
  const events = () => internalRequest('http://127.0.0.1:8090/events', undefined, undefined, 'GET');
  const auth = await core('/v3/meta/auth/verify', { user_key: admin });
  assert.equal(auth.valid, true);
  const userId = auth.user.user_id;
  const teams = await core('/v3/meta/team/list', { user_id: userId, name: 'default-team', limit: 10, offset: 0 });
  assert.equal(teams.items.length, 1);
  const teamId = teams.items[0].team_id;
  const agents = await core('/v3/meta/agent/list', { team_id: teamId, owner_user_id: userId, limit: 10, offset: 0 });
  assert.equal(agents.items.length, 1);
  const agentId = agents.items[0].agent_id;
  // Metadata-only fixture: tests injection, not Wiki ingest/search semantics.
  const knowledgeId = `wiki-smoke-${randomUUID()}`;
  await core('/v3/knowledge/create', { knowledge_id: knowledgeId, type: 'wiki', service_url: 'http://knowledge:8421/v3',
    name: 'Synthetic smoke reference', summary: 'Synthetic release reference', team_id: teamId, user_id: userId });
  await core('/v3/meta/asset/create', { asset_id: knowledgeId, team_id: teamId, asset_type: 'llm_wiki',
    name: 'Synthetic smoke reference', owner_user_id: userId, source_type: 'manual', visibility: 'team', status: 'approved' });
  await core('/v3/meta/agent-fixed-asset/set', { agent_id: agentId,
    bindings: [{ asset_id: knowledgeId, asset_type: 'llm_wiki', created_by: userId }] });

  // The ONLY generated config replacement is this fixture upstream. It cannot
  // hide auth, injection, persistence or pricing configuration defects.
  const proxyConfig = { ...originalConfig, upstream: { url: 'http://model-fixture:8090/v1', apiKey: 'synthetic-fixture-key' } };
  await writeFile(proxyFile, JSON.stringify(proxyConfig, null, 2) + '\n');
  await compose(['restart', 'memory-proxy']);
  await eventually(async () => { try { return (await fetch(proxyOrigin + '/health')).ok; } catch { return false; } }, Boolean, 'Proxy health');
  const sessionId = `ams-smoke-${randomUUID()}`;
  const headers = { authorization: `Bearer ${admin}`, 'content-type': 'application/json', 'x-team-id': teamId,
    'x-agent-id': agentId, 'session-id': sessionId };
  assert.equal('x-task-id' in headers, false);
  const body = { model, instructions: 'Follow the synthetic test user.', stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: userText }] }] };
  const response = await fetch(proxyOrigin + '/codex/ams/v1/responses', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, 'Responses request with selected team/agent and no task');
  const output = await response.text();
  assert.ok(output.includes(assistantText), 'real Proxy returns synthetic assistant output');
  const captured = await events();
  assert.equal(captured.length, 1, 'one completed upstream request');
  assert.equal(captured[0].body.model, model, 'unlisted model survives actual forwarding');
  assert.equal(captured[0].taskHeader, null);
  const finalInstructions = captured[0].body.instructions;
  assert.equal(typeof finalInstructions, 'string');
  assert.ok(finalInstructions.includes('<knowledge_tools>'), 'final model instructions include bound Knowledge');
  assert.ok(finalInstructions.includes('${AMS_USER_KEY:?AMS_USER_KEY is required}'), 'tool auth remains an environment reference');
  assert.ok(finalInstructions.includes('http://127.0.0.1:19422/v3'), 'exact configured public Knowledge origin');
  assert.ok(!JSON.stringify(captured).includes(admin), 'administrator secret absent from captured model body');
  assert.ok(!finalInstructions.includes('http://knowledge:') && !finalInstructions.includes('/v3/v3'));

  const isolation = { team_id: teamId, user_id: userId, agent_id: agentId, session_id: sessionId, limit: 100, offset: 0 };
  const l0 = await eventually(() => core('/v3/conversation/query', isolation), data =>
    data.messages?.some(m => m.role.toLowerCase() === 'user' && m.content.includes(userText))
      && data.messages?.some(m => m.role.toLowerCase() === 'assistant' && m.content.includes(assistantText)), 'Core USER/ASSISTANT L0', 45_000);
  assert.ok(l0.messages.every(message => message.user_id === userId && message.agent_id === agentId));
  const panelHeaders = { 'content-type': 'application/json', 'x-tdai-service-id': 'ams', 'x-tdai-user-key': admin };
  const login = await fetch(panelOrigin + '/api/v1/auth/user-key/login', { method: 'POST', headers: panelHeaders,
    body: JSON.stringify({ instance_id: 'ams', user_key: admin }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).authenticated, true);
  const panelLayer = await fetch(panelOrigin + '/api/v1/chat-memory/layer', { method: 'POST', headers: panelHeaders,
    body: JSON.stringify({ block_id: `chat_memory-${teamId}-${agentId}`, layer: 'L0', limit: 100 }) });
  assert.equal(panelLayer.status, 200);
  const panelBody = await panelLayer.json();
  assert.equal(panelBody.code, 0);
  assert.ok(JSON.stringify(panelBody.data).includes(userText) && JSON.stringify(panelBody.data).includes(assistantText), 'Panel exposes persisted L0');

  // Also traverse the actual generic Chat handler used by the Hermes profile.
  const chat = await fetch(proxyOrigin + '/hermes/ams/v1/chat/completions', { method: 'POST', headers: {
    ...headers, 'x-conversation-id': `ams-chat-${randomUUID()}` }, body: JSON.stringify({ model, stream: false,
    messages: [{ role: 'system', content: 'Synthetic smoke assistant.' }, { role: 'user', content: 'AMS_CHAT_SMOKE' }] }), signal: AbortSignal.timeout(60_000) });
  assert.equal(chat.status, 200, 'generic Chat permits a supported model outside sample pricing');
  assert.ok((await chat.text()).includes(assistantText));

  const beforeCancel = (await events()).length;
  const abort = new AbortController();
  const cancel = await fetch(proxyOrigin + '/codex/ams/v1/responses', { method: 'POST', headers: {
    ...headers, 'session-id': `ams-cancel-${randomUUID()}` }, body: JSON.stringify({ ...body,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AMS_CANCEL_SMOKE' }] }] }), signal: abort.signal });
  assert.equal(cancel.status, 200);
  const reader = cancel.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.ok(Buffer.from(first.value).toString().includes('data:'), 'first SSE chunk arrives before completion');
  const inFlight = (await events()).at(-1);
  assert.equal(inFlight.completed, false);
  abort.abort();
  await reader.cancel().catch(() => {});
  await eventually(events, list => list.length === beforeCancel + 1 && list.at(-1).closed && !list.at(-1).completed,
    'client cancellation closes the actual upstream stream', 10_000);
  await sleep(500);
  assert.equal((await events()).length, beforeCancel + 1, 'cancelled model request is not replayed');
  await writeFile(join(directory, 'model-validation.json'), JSON.stringify({ model, publicModelAuth: true, instructions: true,
    keyInPrompt: false, taskHeaderRequired: false, CoreL0: true, PanelL0: true, chat: true, sseCancellation: true,
    realProvider: 'not-tested', semanticRecall: 'not-tested', wikiIngest: 'not-tested' }, null, 2) + '\n');
});
