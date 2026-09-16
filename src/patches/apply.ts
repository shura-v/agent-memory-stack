import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const patchDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../patches');
const marker = '// agent-memory-stack public-access patch v4\n';

function replaceOne(text: string, before: string, after: string, label: string): string {
  if (text.split(before).length !== 2) throw new Error(`Unsupported upstream source: ${label}`);
  return text.replace(before, after);
}

export async function applyPatches(root: string): Promise<number> {
  const outputs = new Map<string, string>();
  async function patch(path: string, transform: (text: string) => string): Promise<void> {
    const full = resolve(root, path);
    const text = await readFile(full, 'utf8');
    if (text.startsWith(marker)) return;
    if (text.startsWith('// agent-memory-stack public-access patch')) throw new Error('Prepared source has old stack patches; fetch a clean source tree');
    outputs.set(full, marker + transform(text));
  }
  const one = replaceOne;
  await patch('MemoryProxy/src/index.ts', t => {
    t = one(t, 'if (!process.version.startsWith("v22.")) {', 'if (!/^v(?:22|24)\\./.test(process.version)) {', 'Supported Node majors');
    t = one(t, 'Required Node.js version: v22.x', 'Required Node.js version: v22.x or v24.x', 'Node version error');
    t = one(t, 'Please run with Node.js v22.', 'Please run with Node.js v22 or v24.', 'Node version tip');
    return one(t, 'source ~/.nvm/nvm.sh && nvm use 22', 'source ~/.nvm/nvm.sh && nvm use 24', 'Node version command');
  });
  await patch('MemoryProxy/src/server.ts', t => {
    t = 'import { amsGuardRequest } from "./ams-access.js";\n' + t;
    return one(t, '  const app = new Hono();', '  const app = new Hono();\n  app.use("*", async (c, next) => {\n    const denied = await amsGuardRequest(c.req.raw);\n    if (denied) return denied;\n    await next();\n  });', 'Public path guard');
  });
  await patch('MemoryProxy/src/session/store.ts', t => {
    t = 'import { amsAssertSessionOwner } from "../ams-access.js";\n' + t;
    t = one(t, '    this.identities.set(keyId, identity);\n  }',
      '    amsAssertSessionOwner(this.states.get(keyId), identity.userId);\n    amsAssertSessionOwner(this.identities.get(keyId), identity.userId);\n    this.identities.set(keyId, identity);\n  }', 'Session bind ownership');
    return one(t, '    // Bind identity for downstream set()/delete()/probeL2a callchain.',
      '    amsAssertSessionOwner(this.states.get(keyId), identity.userId);\n    amsAssertSessionOwner(this.identities.get(keyId), identity.userId);\n    // Bind identity for downstream set()/delete()/probeL2a callchain.', 'Session recover ownership');
  });
  await patch('MemoryProxy/src/auth.ts', t => one(t,
    '        "content-type": "application/json",',
    '        "content-type": "application/json",\n        "Authorization": `Bearer ${process.env.CORE_API_KEY ?? ""}`,', 'auth verify headers'));
  await patch('MemoryProxy/src/credit-reporter.ts', t => one(t,
    '  // Defense-in-depth: extension telemetry events must never trigger a credit report.',
    '  if (!config.url?.trim()) return { attempted: false, ok: false };\n  // Defense-in-depth: extension telemetry events must never trigger a credit report.', 'credit disabled'));
  await patch('MemoryProxy/src/codexHandler.ts', t => {
    t = one(t, '  const input = body.input;\n  if (!Array.isArray(input) || input.length === 0) return body;',
      '  if (typeof body.instructions === "string") {\n    const block = buildCodexInjectionBlock(assets).text;\n    const base = body.instructions.replace(/<tdai_injections>[\\s\\S]*?<\\/tdai_injections>/g, "").trimEnd();\n    return { ...body, instructions: base + "\\n\\n" + block };\n  }\n  const input = body.input;\n  if (!Array.isArray(input) || input.length === 0) return body;', 'Codex instructions');
    return one(t, '      body: JSON.stringify(body),\n    });',
      '      body: JSON.stringify(body),\n      signal: c.req.raw.signal,\n    });', 'Codex cancellation');
  });
  for (const file of ['handler', 'anthropicHandler']) {
    await patch(`MemoryProxy/src/${file}.ts`, t => {
      t = one(t, '  rateLimitContext?: { config: ProxyConfig; instanceId?: string },\n): Promise<{ resp: Response; retried: boolean }>',
        '  rateLimitContext?: { config: ProxyConfig; instanceId?: string },\n  requestSignal?: AbortSignal,\n): Promise<{ resp: Response; retried: boolean }>', `${file} cancellation argument`);
      t = one(t, '      { config, instanceId: spaceId || undefined },\n    );',
        '      { config, instanceId: spaceId || undefined },\n      c.req.raw.signal,\n    );', `${file} request signal`);
      t = one(t, '    forwardFailed = true;', '    if (requestSignal?.aborted) throw requestSignal.reason;\n    forwardFailed = true;', `${file} no retry on cancel`);
      if (file === 'handler') {
        t = one(t, '    body: JSON.stringify(upstreamBody),\n  };', '    body: JSON.stringify(upstreamBody),\n    signal: requestSignal,\n  };', 'Chat request cancel');
        t = one(t, '        body: JSON.stringify(retryBody),\n      };', '        body: JSON.stringify(retryBody),\n        signal: requestSignal,\n      };', 'Chat retry cancel');
      }
      const oldSignal = 'AbortSignal.timeout(forwardTimeoutMs)';
      if (t.split(oldSignal).length !== 3) throw new Error(`Unsupported upstream source: ${file} timeout signals`);
      return t.replaceAll(oldSignal, '(requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(forwardTimeoutMs)]) : AbortSignal.timeout(forwardTimeoutMs))');
    });
  }
  await patch('MemoryProxy/src/injection/injectors/knowledge-tools-injector.ts', t => {
    t = 'import { amsAssetAllowed, amsPublicOrigin } from "../../ams-access.js";\n' + t;
    t = one(t, '  async execute(ctx: AgentContext): Promise<ContextBlock[]> {', '  async execute(ctx: AgentContext): Promise<ContextBlock[]> {\n    if (process.env.AMS_KNOWLEDGE_HTTP_ENABLED !== "true") return [];', 'Disable Knowledge execution');
    t = one(t, '  async prewarm(input: PrewarmInput): Promise<ContextBlock[]> {', '  async prewarm(input: PrewarmInput): Promise<ContextBlock[]> {\n    if (process.env.AMS_KNOWLEDGE_HTTP_ENABLED !== "true") return [];', 'Disable Knowledge prewarm');
    t = one(t, '  cacheStrategy: CacheStrategy = "session_init";', '  cacheStrategy: CacheStrategy = "none";', 'Knowledge live ACL');
    t = one(t, '  if (!resources || resources.length === 0) return null;',
      '  if (process.env.AMS_KNOWLEDGE_HTTP_ENABLED !== "true" || !resources || resources.length === 0) return null;\n  const publicUrl = amsPublicOrigin("AMS_KNOWLEDGE_URL") + "/v3";', 'Knowledge public URL');
    t = one(t, 'url="${r.service_url}"', 'url="${xmlAttrEscape(publicUrl.replace(/\\/+$/, ""))}"', 'Knowledge URL rendering');
    t = one(t, '  const requestHeaderLines = [', '  const requestHeaderLines = [\n    \'  -H "Authorization: Bearer ${AMS_USER_KEY:?AMS_USER_KEY is required}" \\\\\',', 'Knowledge env key');
    t = one(t, '      resources = filterResourcesByCapabilities(resources, assetCapabilities);',
      '      resources = filterResourcesByCapabilities(resources, assetCapabilities);\n      const permitted: KnowledgeItem[] = [];\n      for (const resource of resources) {\n        if (await amsAssetAllowed(userKey ?? undefined, telemetryContext.userId ?? "", resource.knowledge_id)) permitted.push(resource);\n      }\n      resources = permitted;', 'Knowledge resource ACL');
    return t.replaceAll('curl -sSk', 'curl -sS --fail-with-body');
  });
  for (const name of ['skill-tools-injector', 'tdai-tools-injector']) {
    await patch(`MemoryProxy/src/injection/injectors/${name}.ts`, t => {
      t = 'import { amsPublicOrigin } from "../../ams-access.js";\n' + t;
      t = one(t, '  const base = proxyBaseUrl.replace(/\\/$/, "");',
        '  const base = amsPublicOrigin("AMS_PROXY_URL");', `${name} URL`);
      t = one(t, '  const authHeader = `${tenantHeader}${sessionHeader}`;',
        '  const authHeader = `${tenantHeader}${sessionHeader}` + \' -H "Authorization: Bearer ${AMS_USER_KEY:?AMS_USER_KEY is required}"\';', `${name} env key`);
      return t.replaceAll('curl -sSk', 'curl -sS --fail-with-body').replaceAll('curl -sfk', 'curl -sf');
    });
  }
  for (const name of ['skill/skill-bridge', 'memory/memory-bridge']) {
    await patch(`MemoryProxy/src/${name}.ts`, t => {
      t = 'import { amsAuthorizeBridge, amsAssetAllowed, amsFilterSkills } from "../ams-access.js";\n' + t;
      const anchor = name.startsWith('skill') ? '    // backing.redis 之前给老链路 SkillExtractTrigger 用, 老链路已删,' : '    let inboundBody: Record<string, unknown> = {};';
      t = one(t, anchor,
        '    if (!await amsAuthorizeBridge((name) => c.req.header(name), ids)) {\n      return envelope(40301, "Access denied", 403);\n    }\n' + anchor, `${name} session auth`);
      if (name.startsWith('skill')) {
        t = one(t, '    // ── files/download: read from core, decode, return raw bytes ──────',
          '    if (!["search", "get", "files/read", "files/download", "extract"].includes(sub)) return envelope(40301, "Operation unavailable", 403);\n    if (["get", "files/read", "files/download"].includes(sub) &&\n        (typeof inboundBody.skill_id !== "string" || !await amsAssetAllowed(ids.user_key, ids.user_id, inboundBody.skill_id))) {\n      return envelope(40301, "Access denied", 403);\n    }\n\n    // ── files/download: read from core, decode, return raw bytes ──────', 'Skill asset ACL');
        t = one(t, '    // ── Lazy-pin: extract version from response and record in pin repo ──',
          '    if (isTeamWideSearch && resp.ok) finalRespText = await amsFilterSkills(finalRespText, ids);\n\n    // ── Lazy-pin: extract version from response and record in pin repo ──', 'Skill search ACL');
      }
      return t;
    });
  }
  await patch('MemoryProxy/src/injection/injectors/tdai-fixed-asset.ts', t => {
    t = 'import { amsAssetAllowed } from "../../ams-access.js";\n' + t;
    return one(t, '        items.push({',
      '        if (!await amsAssetAllowed(identity.userKey, identity.userId, item.asset_id)) continue;\n        items.push({', 'Imported memory ACL');
  });
  await patch('MemoryProxy/src/injection/injectors/skill-injector.ts', t => {
    t = 'import { amsFilterListing } from "../../ams-access.js";\n' + t;
    t = one(t, '  cacheStrategy: CacheStrategy = "session_init";', '  cacheStrategy: CacheStrategy = "none";', 'Skill live ACL');
    t = one(t, '      space_id: session?.space_id,',
      '      space_id: session?.space_id,\n      user_key: typeof custom?.userKey === "string" ? custom.userKey : undefined,\n      user_id: (custom?.session as { user_id?: string } | undefined)?.user_id,', 'Skill execute identity');
    t = one(t, '      space_id: ids?.space_id,',
      '      space_id: ids?.space_id,\n      user_key: input.callerUserKey,\n      user_id: ids?.user_id || input.userId,', 'Skill prewarm identity');
    t = one(t, '    query: string | undefined;\n    trigger: "prewarm" | "execute";',
      '    user_key?: string;\n    user_id?: string;\n    query: string | undefined;\n    trigger: "prewarm" | "execute";', 'Skill args identity');
    return one(t, '    const listing = result.listing;',
      '    const listing = await amsFilterListing(result.listing, args.user_key, args.user_id ?? "");', 'Skill listing ACL');
  });
  await patch('MemoryCore/src/gateway/server.ts', t => {
    t = 'import { persistentIdentity, coreIdentityRoute } from "../ams-integration.js";\n' + t;
    return one(t, '    this.server = http.createServer((req, res) => {',
      '    const amsCoreId = persistentIdentity();\n    this.server = http.createServer((req, res) => {\n      if (req.url === "/ams/identity") { void coreIdentityRoute(req, res, amsCoreId); return; }', 'Core service identity');
  });
  await patch('MemoryKnowledge/src/server.ts', t => {
    t = 'import { persistentIdentity } from "./ams-integration.js";\n' + t;
    return one(t, '  const config = loadConfig();', '  persistentIdentity();\n  const config = loadConfig();', 'Knowledge persistent identity');
  });
  await patch('MemoryKnowledge/src/callback.ts', t => {
    t = 'import { callbackHeaders } from "./ams-integration.js";\n' + t;
    t = one(t, '        headers: { "Content-Type": "application/json" },',
      '        headers: await callbackHeaders(),\n        redirect: "error",', 'Completion callback authentication');
    t = one(t, '  void fetch(url, {', '  void callbackHeaders().then(headers => fetch(url, {', 'Progress callback authentication');
    t = one(t, '    headers: { "Content-Type": "application/json" },', '    headers,\n    redirect: "error",', 'Progress callback headers');
    return one(t, '  }).catch((err) => {', '  })).catch((err) => {', 'Progress callback promise');
  });
  await patch('MemoryPanel/src/panel/http/app.ts', t => {
    t = 'import { persistentIdentity, panelIdentityResponse } from "../../ams-integration.js";\n' + t;
    t = one(t, '  const app = new Hono();', '  const app = new Hono();\n  const amsPanelId = persistentIdentity();\n  app.get("/ams/identity", c => panelIdentityResponse(c.req.raw, amsPanelId));\n  app.get("/ams/features", c => c.json({ knowledge: process.env.AMS_KNOWLEDGE_ENABLED !== "false" }));', 'Panel identity and features');
    return one(t, '  registerKnowledgeRoutes(api, deps);', '  if (process.env.AMS_KNOWLEDGE_ENABLED !== "false") registerKnowledgeRoutes(api, deps);', 'Disable Panel Knowledge API');
  });
  await patch('MemoryPanel/src/panel/config/panel-config.ts', t => one(t,
    "      baseUrl: env('KNOWLEDGE_SERVICE_URL', 'http://127.0.0.1:8421'),",
    "      baseUrl: process.env.AMS_KNOWLEDGE_ENABLED === 'false' ? '' : env('KNOWLEDGE_SERVICE_URL', ''),", 'No fabricated Knowledge endpoint'));
  await patch('MemoryPanel/src/panel/http/routes/knowledge/callback-routes.ts', t => {
    t = 'import { persistentIdentity, callbackDenied } from "../../../../ams-integration.js";\n' + t;
    t = one(t, "  const log = deps.logger;\n\n  api.post('/knowledge/status-callback', async (c) => {",
      "  const log = deps.logger;\n  const amsPanelId = persistentIdentity();\n\n  api.post('/knowledge/status-callback', async (c) => {\n    const denied = await callbackDenied(c.req.raw, amsPanelId);\n    if (denied) return denied;", 'Authenticated Panel callback receiver');
    return one(t, '    const body = await safeJson(c);', '    const body = await safeJson(c);\n    if (body.service_id !== "ams") return c.json({ code: 403, message: "Service identity rejected", data: null }, 403);', 'Callback instance binding');
  });
  await patch('MemoryPanel/web/src/layouts/ConsoleLayout.tsx', t => {
    t = 'import { useAmsKnowledge } from "../ams-features";\n' + t;
    t = one(t, 'export function ConsoleLayout() {', 'export function ConsoleLayout() {\n  const amsKnowledge = useAmsKnowledge();', 'Panel Knowledge feature state');
    t = one(t, '    for (const meta of Object.values(PAGE_META)) {', '    for (const meta of Object.values(PAGE_META)) {\n      if (!amsKnowledge && ["wiki", "code"].includes(meta.id)) continue;', 'Panel Knowledge navigation');
    t = one(t, '  }, [userRole, PAGE_META, t, analyticsVisible]);', '  }, [userRole, PAGE_META, t, analyticsVisible, amsKnowledge]);', 'Panel feature memo');
    return one(t, '                pages={openPages}', '                pages={openPages.filter(page => amsKnowledge || !["wiki", "code"].includes(page))}', 'Panel Knowledge tabs');
  });
  await patch('MemoryPanel/web/src/routes/index.tsx', t => {
    t = 'import { AmsKnowledge } from "../ams-features";\n' + t;
    t = one(t, "{ path: 'wiki', element: <WikiPage /> }", "{ path: 'wiki', element: <AmsKnowledge><WikiPage /></AmsKnowledge> }", 'Panel Wiki route gate');
    return one(t, "{ path: 'code', element: <CodePage /> }", "{ path: 'code', element: <AmsKnowledge><CodePage /></AmsKnowledge> }", 'Panel code graph route gate');
  });
  await patch('MemoryPanel/web/src/layouts/OnboardingGuide.tsx', t => {
    t = 'import { useAmsKnowledge } from "../ams-features";\n' + t;
    return one(t, "  const steps = useMemo(() => buildSteps(isAdmin ? 'admin' : 'member'), [isAdmin]);",
      "  const amsKnowledge = useAmsKnowledge();\n  const steps = useMemo(() => buildSteps(isAdmin ? 'admin' : 'member').filter(step => amsKnowledge || !['/wiki', '/code'].includes(step.path ?? '')), [isAdmin, amsKnowledge]);", 'Panel Knowledge onboarding');
  });
  // Stage all transforms in memory first: an unsupported source changes no files.
  outputs.set(resolve(root, 'MemoryProxy/src/ams-access.ts'), await readFile(resolve(patchDir, 'ams-access.ts'), 'utf8'));
  outputs.set(resolve(root, 'MemoryPanel/web/src/ams-features.tsx'), await readFile(resolve(patchDir, 'ams-features.tsx'), 'utf8'));
  for (const component of ['MemoryCore', 'MemoryKnowledge', 'MemoryPanel']) {
    for (const extension of ['js', 'd.ts']) outputs.set(resolve(root, `${component}/src/ams-integration.${extension}`), await readFile(resolve(patchDir, `../dist/runtime/service-identity.${extension}`), 'utf8'));
  }
  for (const [path, text] of outputs) await writeFile(path, text);
  return outputs.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node dist/patches/apply.js PREPARED_SOURCE_ROOT');
  console.log(`Applied stack patches to ${await applyPatches(resolve(process.argv[2]))} files`);
}
