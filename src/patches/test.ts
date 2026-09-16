// Run against the pinned prepared checkout (or an explicit read-only upstream path).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import http from 'node:http';
import { applyPatches } from './apply.js';
import { callbackDenied, callbackHeaders } from '../runtime/service-identity.js';

const source = resolve(process.argv[2] || '.cache/upstream/tencent');
const temp = await mkdtemp(join(tmpdir(), 'ams-patched-source-'));
const files = ['index', 'auth', 'credit-reporter', 'codexHandler', 'server', 'session/store', 'handler', 'anthropicHandler', 'injection/injectors/knowledge-tools-injector',
  'injection/injectors/skill-tools-injector', 'injection/injectors/tdai-tools-injector',
  'skill/skill-bridge', 'memory/memory-bridge', 'injection/injectors/tdai-fixed-asset', 'injection/injectors/skill-injector'];
const integrationFiles = ['MemoryCore/src/gateway/server.ts', 'MemoryKnowledge/src/server.ts', 'MemoryKnowledge/src/callback.ts', 'MemoryPanel/src/panel/config/panel-config.ts', 'MemoryPanel/src/panel/http/app.ts', 'MemoryPanel/src/panel/http/routes/knowledge/callback-routes.ts', 'MemoryPanel/web/src/layouts/ConsoleLayout.tsx', 'MemoryPanel/web/src/routes/index.tsx', 'MemoryPanel/web/src/layouts/OnboardingGuide.tsx'];
try {
  for (const file of files) {
    const target = join(temp, 'MemoryProxy/src', `${file}.ts`);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(source, 'MemoryProxy/src', `${file}.ts`), target);
  }
  for (const file of integrationFiles) { await mkdir(dirname(join(temp, file)), { recursive: true }); await copyFile(join(source, file), join(temp, file)); }
  const count = await applyPatches(temp);
  assert.ok(count === files.length + integrationFiles.length + 8 || count === 8, 'fresh or already patched source');
  assert.equal(await applyPatches(temp), 8, 'patches are idempotent');
  for (const file of integrationFiles.filter(file => file.endsWith('.ts'))) stripTypeScriptTypes(await readFile(join(temp, file), 'utf8'), { mode: 'transform' });
  const callbackReceiver = stripTypeScriptTypes(await readFile(join(temp, 'MemoryPanel/src/panel/http/routes/knowledge/callback-routes.ts'), 'utf8'), { mode: 'transform' });
  const callbackSender = stripTypeScriptTypes(await readFile(join(temp, 'MemoryKnowledge/src/callback.ts'), 'utf8'), { mode: 'transform' });
  const registerSource = callbackReceiver.match(/export function registerKnowledgeCallbackRoutes\([\s\S]*?^\}/m)?.[0];
  const safeJsonSource = callbackReceiver.match(/async function safeJson\([\s\S]*?^\}/m)?.[0];
  const progressSource = callbackReceiver.match(/function isProgressPhase\([\s\S]*?^\}/m)?.[0];
  assert.ok(registerSource && safeJsonSource && progressSource);
  const savedEnv = { ...process.env }; const savedFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { AMS_CORE_API_KEY: 'callback-service-key', AMS_CORE_URL: 'http://core/prefix', AMS_KNOWLEDGE_SERVICE_URL: 'http://knowledge/prefix', AMS_KNOWLEDGE_ENABLED: 'true' });
    globalThis.fetch = (async (url, options) => {
      assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer callback-service-key');
      if (String(url) === 'http://core/prefix/ams/identity') return Response.json({ coreId: 'core-one' });
      if (String(url) === 'http://knowledge/prefix/ams/identity') return Response.json({ coreId: 'core-one', knowledgeId: 'knowledge-one' });
      throw new Error('Unexpected callback identity URL');
    }) as typeof fetch;
    let handler: (context: unknown) => Promise<Response> = async () => { throw new Error('Missing route'); };
    const updates: unknown[] = []; const entities: Array<{ path: string; body: Record<string, unknown> }> = [];
    const register = new Function('persistentIdentity', 'callbackDenied', `${safeJsonSource}\n${progressSource}\n${registerSource.replace('export ', '')}; return registerKnowledgeCallbackRoutes;`)(() => 'panel-one', callbackDenied);
    register({ post(path: string, fn: typeof handler) { assert.equal(path, '/knowledge/status-callback'); handler = fn; } }, {
      logger: { info() {}, warn() {}, error() {} }, config: { metadataRemoteTimeoutMs: 5000 },
      ingestProgressStore: { update(...args: unknown[]) { updates.push(args); }, clear() {} },
      instanceRegistry: { resolve(id: string) { assert.equal(id, 'ams'); return { instance_id: 'ams', gateway_endpoint: 'http://core/prefix', api_key: 'callback-service-key' }; } },
      knowledgeClientFactory() { return { async wikiGet() { return { wiki_id: 'wiki-one', team_id: 'team-one', owner_user_id: 'creator-one', name: 'Team wiki', service_url: 'http://knowledge/prefix/v3' }; } }; },
      kernelHttp: { async postEnvelope(path: string, body: Record<string, unknown>) { entities.push({ path, body }); } },
    });
    const invoke = async (body: unknown, headers: Record<string, string>): Promise<Response> => {
      const raw = new Request('http://panel/prefix/api/v1/knowledge/status-callback', { method: 'POST', headers, body: JSON.stringify(body) });
      return handler({ req: { raw, text: () => raw.text() }, json: (value: unknown, status = 200) => Response.json(value, { status }) });
    };
    const headers = await callbackHeaders();
    const ready = { knowledge_id: 'wiki-one', type: 'wiki', status: 'ready', service_id: 'ams', summary: 'Retained summary' };
    assert.equal((await invoke(ready, {})).status, 401);
    assert.equal((await invoke(ready, { ...headers, 'x-ams-knowledge-id': 'wrong-knowledge' })).status, 409);
    assert.equal((await invoke({ ...ready, service_id: 'other' }, headers)).status, 403);
    assert.equal(entities.length, 0);
    assert.equal((await invoke(ready, headers)).status, 200);
    assert.equal(entities.length, 1);
    assert.equal(entities[0]?.path, '/v3/knowledge/create');
    assert.equal(entities[0]?.body.user_id, 'creator-one');
    assert.equal(entities[0]?.body.team_id, 'team-one');
    assert.equal(entities[0]?.body.summary, 'Retained summary');
    const progress = { event: 'ingest_progress', wiki_id: 'wiki-one', service_id: 'ams', run_id: 'run-one', progress: { phase: 'extracting', total: 1, completed: 0, failed: 0, skipped: 0, percent: 0 } };
    assert.equal((await invoke(progress, {})).status, 401); assert.equal(updates.length, 0);
    assert.equal((await invoke(progress, headers)).status, 200); assert.equal(updates.length, 1);
    const sendSource = callbackSender.match(/export async function callbackTMC\([\s\S]*?^\}/m)?.[0];
    const sendProgressSource = callbackSender.match(/export function sendProgressCallback\([\s\S]*?^\}/m)?.[0];
    assert.ok(sendSource && sendProgressSource);
    const sent: unknown[] = [];
    const outbound = async (url: string, options: RequestInit) => { assert.equal(url, 'http://panel/prefix/api/v1/knowledge/status-callback'); assert.equal(options.redirect, 'error'); assert.deepEqual(options.headers, headers); sent.push(JSON.parse(String(options.body))); return Response.json({ code: 0 }); };
    const sender = new Function('callbackHeaders', 'fetch', 'TAG', 'RETRY_DELAY_MS', `${sendSource.replace('export ', '')};return callbackTMC;`)(callbackHeaders, outbound, 'test', 0);
    await sender(ready, { tmcCallbackUrl: 'http://panel/prefix/' });
    const progressSender = new Function('callbackHeaders', 'fetch', 'TAG', `${sendProgressSource.replace('export ', '')};return sendProgressCallback;`)(callbackHeaders, outbound, 'test');
    progressSender('http://panel/prefix/', progress);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, [ready, progress], 'callbacks preserve all creator/progress payload context');
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
  const compiled = new Map<string, string>();
  for (const file of [...files, 'ams-access']) compiled.set(file,
    stripTypeScriptTypes(await readFile(join(temp, 'MemoryProxy/src', `${file}.ts`), 'utf8'), { mode: 'transform' }));
  const helpers = await import(`data:text/javascript;base64,${Buffer.from(compiled.get('ams-access')!).toString('base64')}`);
  const guardSource = compiled.get('index')!.match(/^if \([\s\S]*?^\}/m)?.[0];
  assert.ok(guardSource);
  const nodeGuard = new Function('process', 'console', guardSource);
  for (const version of ['v22.0.0', 'v22.99.1', 'v24.21.0']) nodeGuard({ version, exit() { assert.fail(version); } }, { error() {} });
  for (const version of ['v20.20.0', 'v23.1.0', 'v25.0.0', 'v26.0.0', 'v220.0.0']) {
    let exitCode: number | undefined;
    nodeGuard({ version, exit(code: number) { exitCode = code; } }, { error() {} });
    assert.equal(exitCode, 1, version);
  }
  const bindSource = compiled.get('session/store')!.match(/    bind\(keyId, identity\) \{[\s\S]*?^    \}/m)?.[0];
  assert.ok(bindSource, 'patched SessionStore.bind function');
  const bind = new Function('amsAssertSessionOwner', `return ({${bindSource}}).bind;`)(helpers.amsAssertSessionOwner);
  const store = { states: new Map(), identities: new Map() };
  bind.call(store, 'pending', { userId: 'alice' });
  assert.throws(() => bind.call(store, 'pending', { userId: 'mallory' }), /another user/);
  assert.equal(store.identities.get('pending').userId, 'alice');

  const authSource = compiled.get('auth')!.match(/export async function verifyUserKey\([\s\S]*?^\}/m)?.[0];
  assert.ok(authSource);
  const authFetch = async (_url: string, options: RequestInit): Promise<Response> => {
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-core-key');
    assert.equal(new Headers(options.headers).get('x-tdai-service-id'), 'ams');
    assert.equal(JSON.parse(String(options.body)).user_key, 'test-user-key');
    return Response.json({ code: 0, data: { valid: true, user: { user_id: 'alice' } } });
  };
  const verify = new Function('config', 'log', 'fetch', 'process', `${authSource.replace('export ', '')}; return verifyUserKey;`)(
    { url: 'http://core:8420', timeoutMs: 0 }, { warn() {} }, authFetch, { env: { CORE_API_KEY: 'test-core-key' } });
  assert.deepEqual(await verify('test-user-key', 'ams'), { userId: 'alice', rejected: false });

  const creditSource = compiled.get('credit-reporter')!.match(/export async function tryReportCreditFromPath\([\s\S]*?^\}/m)?.[0];
  assert.ok(creditSource);
  const credit = new Function(`${creditSource.replace('export ', '')}; return tryReportCreditFromPath;`)();
  // All downstream helpers intentionally absent: disabled reporting must return before calling any.
  assert.deepEqual(await credit({ url: '' }, '/codex/ams/v1/responses', { input_tokens: 100 }, {}), { attempted: false, ok: false });

  const buildSource = stripTypeScriptTypes(await readFile(join(source, 'MemoryProxy/src/common/codex-injection.ts'), 'utf8'), { mode: 'transform' });
  const builder = (await import(`data:text/javascript;base64,${Buffer.from(buildSource).toString('base64')}`)).buildCodexInjectionBlock;
  const functionText = compiled.get('codexHandler')!.match(/export function injectCodexAssets\([\s\S]*?^\}/m)?.[0];
  assert.ok(functionText);
  const inject = new Function('buildCodexInjectionBlock', `${functionText.replace('export ', '')}; return injectCodexAssets;`)(builder);
  const original = { instructions: 'Follow the user', input: [{ type: 'function_call_output', output: 'ok' }] };
  const injected = inject(original, { raw: '<knowledge_tools>tools</knowledge_tools>' });
  assert.match(injected.instructions, /Follow the user[\s\S]*<knowledge_tools>/);
  assert.equal(injected.input, original.input);
  assert.equal(original.instructions, 'Follow the user');
  assert.equal(inject(injected, { raw: 'new' }).instructions.match(/<tdai_injections>/g).length, 1);
  assert.match(inject({ instructions: '' }, { raw: 'tools' }).instructions, /tools/);
  const legacy = inject({ input: [{ type: 'message', role: 'developer', content: [] }] }, { raw: 'legacy' });
  assert.match(legacy.input[0].content[0].text, /legacy/);

  const knowledge = compiled.get('injection/injectors/knowledge-tools-injector')!;
  const renderSource = knowledge.slice(knowledge.indexOf('function shellQuote'), knowledge.indexOf('export class KnowledgeToolsInjector'));
  const render = new Function('amsPublicOrigin', `${renderSource.replaceAll('export ', '')}; return renderKnowledgeToolsBlock;`)(helpers.amsPublicOrigin);
  const old = process.env.AMS_KNOWLEDGE_URL;
  try {
    for (const origin of ['https://memory.example', 'http://localhost:8422', 'http://192.168.1.20:8422', 'http://[::1]:8422']) {
      process.env.AMS_KNOWLEDGE_URL = origin + '/';
      const text: string = render([{ knowledge_id: 'wiki-one', type: 'wiki', name: 'Team docs', service_url: 'http://knowledge:8421/v3' }], 'ams');
      assert.ok(text.includes(`url="${origin}/v3"`), 'preserve the chosen scheme, host and port');
      assert.match(text, /\$\{AMS_USER_KEY:\?AMS_USER_KEY is required\}/);
      assert.doesNotMatch(text, /http:\/\/knowledge:|curl -sSk|--insecure/);
      assert.doesNotMatch(text, /\/v3\/v3/);
      const finalModelBody = inject({ instructions: 'Follow the user', input: [] }, { raw: text });
      assert.match(finalModelBody.instructions, /<knowledge_tools>/);
      assert.match(finalModelBody.instructions, /\$\{AMS_USER_KEY:/);
      assert.doesNotMatch(JSON.stringify(finalModelBody), /http:\/\/knowledge:|curl -sSk|--insecure/);
      const headerLine = text.split('\n').find(line => line.includes('Authorization: Bearer'));
      assert.ok(headerLine?.endsWith('\\'), 'curl Authorization line continues the command');
    }
    process.env.AMS_KNOWLEDGE_ENABLED = 'false';
    delete process.env.AMS_KNOWLEDGE_URL;
    assert.equal(render([{ knowledge_id: 'disabled', type: 'wiki' }], 'ams'), null);
    delete process.env.AMS_KNOWLEDGE_ENABLED;
  } finally { if (old === undefined) delete process.env.AMS_KNOWLEDGE_URL; else process.env.AMS_KNOWLEDGE_URL = old; }
  for (const file of ['handler', 'anthropicHandler']) {
    const code = compiled.get(file)!.match(/async function forwardWithRetry\([\s\S]*?^\}/m)?.[0];
    assert.ok(code);
    const forward = new Function('isRateLimitExceededError', `${code}; return forwardWithRetry;`)(() => false);
    let calls = 0;
    const server = http.createServer((_req, res) => { calls++; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}`;
      const controller = new AbortController();
      const pipe = { error() {}, info() {}, forwardDone() {} };
      const result = await forward({ url, retryTarget: { url } }, {}, { stream: true }, {}, {}, pipe, 10_000, undefined, undefined, controller.signal);
      const reader = result.resp.body.getReader();
      const chunk = await reader.read();
      assert.match(Buffer.from(chunk.value).toString(), /first/);
      controller.abort();
      await assert.rejects(reader.read());
      assert.equal(calls, 1, 'accepted streaming request must not be replayed');
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  console.log('Pinned source patches: syntax, idempotence, session ownership, Codex instructions, literal env key, HTTP(S) origins and streaming cancellation passed');
} finally {
  await rm(temp, { recursive: true, force: true });
}
