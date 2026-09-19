import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareNativeConfiguration } from '../dist/config/native-state.js';
import { resolveSettings } from '../dist/config/settings.js';

const enabled = process.env.AMS_UPSTREAM_LLM_TEST === '1';
const engine = process.env.AMS_CONTAINER_ENGINE ?? 'podman';
const imagePrefix = process.env.AMS_TEST_IMAGE_PREFIX ?? 'agent-memory-stack';
const settings = resolveSettings({
  MEMORY_PROXY_PUBLIC_URL: 'https://models.synthetic.invalid', KNOWLEDGE_PUBLIC_URL: 'https://wiki.synthetic.invalid',
  PANEL_PUBLIC_URL: 'https://panel.synthetic.invalid',
  LLM_BASE_URL: 'http://127.0.0.1:19387/fixture/v4', LLM_API_KEY: 'synthetic-\'"\\$literal-${DO_NOT_EXPAND}-`',
  MEMORY_LLM_MODEL: 'core-outgoing-fixture', KNOWLEDGE_LLM_MODEL: 'knowledge-outgoing-fixture',
  MEMORY_LLM_MAX_TOKENS: '321', KNOWLEDGE_LLM_MAX_TOKENS: '654',
  MEMORY_LLM_TIMEOUT_MS: '10000', KNOWLEDGE_LLM_TIMEOUT_MS: '10000',
  CORE_API_KEY: 'synthetic-core-service', CLIPROXY_API_KEY: 'synthetic-cliproxy-service', LOG_LEVEL: 'error',
});

async function checkOutgoing(t, image, imports, expectedModel, expectedTokens, invoke) {
  const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ams-upstream-llm-'));
  const container = `ams-llm-test-${randomUUID()}`;
  t.after(async () => {
    try { execFileSync(engine, ['rm', '--force', container], { stdio: 'ignore' }); } catch { /* --rm already removed it. */ }
    await rm(directory, { recursive: true, force: true });
  });
  await chmod(directory, 0o755);
  const native = await prepareNativeConfiguration(join(directory, 'runtime'), settings, { root: join(directory, 'native') });
  for (const [name, text] of Object.entries(native.documents)) {
    await writeFile(join(directory, name), text, { mode: 0o644 });
  }
  await writeFile(join(directory, 'expected.json'), JSON.stringify(settings), { mode: 0o644 });
  const identity = execFileSync(engine, ['image', 'inspect', '--format', '{{.Id}}', `${imagePrefix}/${image}:local`], { encoding: 'utf8' }).trim();
  assert.match(identity, /^(?:sha256:)?[a-f0-9]{64}$/);
  const program = `
    import assert from 'node:assert/strict';
    import { readFileSync, readdirSync } from 'node:fs';
    import { createServer } from 'node:http';
    const expected = JSON.parse(readFileSync('/config/expected.json', 'utf8'));
    process.env.DO_NOT_EXPAND = 'incorrect-expansion';
    const requests = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ method: request.method, path: request.url, authorization: request.headers.authorization, body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'chatcmpl-fixture', object: 'chat.completion', created: 1700000000, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'fixture-ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }));
    });
    await new Promise(resolve => server.listen(19387, '127.0.0.1', resolve));
    try {
      ${invoke}
      assert.equal(text, 'fixture-ok');
      assert.equal(requests.length, 1, 'one accepted model request, no retry');
      const request = requests[0];
      assert.equal(request.method, 'POST');
      assert.equal(request.path, '/fixture/v4/chat/completions');
      assert.equal(request.authorization, 'Bearer ' + expected.LLM_API_KEY);
      assert.equal(request.body.model, expected[${JSON.stringify(expectedModel)}]);
      assert.equal(request.body.max_tokens ?? request.body.max_completion_tokens, Number(expected[${JSON.stringify(expectedTokens)}]));
      assert.ok(request.body.messages.some(message => message.role === 'system' && message.content === 'fixture-system'));
      assert.ok(request.body.messages.some(message => message.role === 'user' && message.content === 'fixture-prompt'));
      assert.ok(request.body.stream === undefined || request.body.stream === false);
      assert.equal(request.body.tools, undefined);
      console.log(JSON.stringify({ marker: 'UPSTREAM_LLM_OK', method: request.method, path: request.path,
        model: request.body.model, exactAuthorization: true, requests: requests.length }));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `;
  const output = execFileSync(engine, [
    'run', '--rm', '--name', container, '-i', '--network', 'none', '--read-only', '--tmpfs', '/tmp',
    '--mount', `type=bind,source=${directory},target=/config,readonly`,
    ...(image === 'core' ? ['-e', 'TDAI_GATEWAY_CONFIG=/config/core.yaml'] : ['--mount', `type=bind,source=${directory}/knowledge.env,target=/app/.env,readonly`]),
    '--entrypoint', 'node', identity, ...imports, '--input-type=module', '-',
  ], { input: program, encoding: 'utf8', timeout: 45_000, stdio: ['pipe', 'pipe', 'pipe'] });
  const line = output.split('\n').find(value => value.includes('"marker":"UPSTREAM_LLM_OK"'));
  assert.ok(line, 'the real upstream client completed and the HTTP fixture verified the request');
  const observed = JSON.parse(line);
  assert.equal(observed.model, settings[expectedModel]);
  assert.equal(observed.exactAuthorization, true);
  t.diagnostic(`${image}: ${identity}; ${observed.method} ${observed.path}; model=${observed.model}; exact Authorization confirmed`);
}

test('Core real StandaloneLLMRunner uses native direct model settings on the wire', { skip: !enabled }, async t => {
  await checkOutgoing(t, 'core', ['--import', 'tsx'], 'MEMORY_LLM_MODEL', 'MEMORY_LLM_MAX_TOKENS', `
    const { loadGatewayConfig } = await import('/app/src/gateway/config.ts');
    const { StandaloneLLMRunner } = await import('/app/src/adapters/standalone/llm-runner.ts');
    const config = loadGatewayConfig();
    assert.equal(config.memory.llm.enabled, true);
    const runner = new StandaloneLLMRunner({ config: config.memory.llm, enableTools: false });
    const text = await runner.run({ taskId: 'ams-config-fixture', systemPrompt: 'fixture-system', prompt: 'fixture-prompt' });
  `);
});

test('Knowledge bundled wiki LLM client uses its own native model settings on the wire', { skip: !enabled }, async t => {
  await checkOutgoing(t, 'knowledge', [], 'KNOWLEDGE_LLM_MODEL', 'KNOWLEDGE_LLM_MAX_TOKENS', `
    const { loadConfig } = await import('/app/src/config.ts');
    const config = loadConfig();
    assert.equal(config.llm.mode, 'custom');
    // The runtime build exposes the real wiki client in a chunk with a hashed
    // filename. Resolve its named export instead of copying its implementation.
    const clients = [];
    for (const filename of readdirSync('/app/dist').filter(name => /^llm-.*\\.mjs$/.test(name))) {
      const module = await import('/app/dist/' + filename);
      if (typeof module.createLlmClient === 'function') clients.push(module.createLlmClient);
    }
    assert.equal(clients.length, 1, 'one named bundled wiki LLM client export');
    const client = clients[0](config.llm);
    const text = await client.chat({ system: 'fixture-system', prompt: 'fixture-prompt', label: 'ams-config-fixture' });
  `);
});
