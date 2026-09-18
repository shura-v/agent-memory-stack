import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { setupServer as runSetupServer } from '../dist/setup/server.js';
import { serverQuestions as askServerQuestions, selectServices } from '../dist/setup/questions.js';
import { resolveDeployment, serviceNames } from '../dist/deployment/model.js';
import { fields, generateKey, validateEnv } from '../dist/config/settings.js';
import { readEnv, encodeEnv } from '../dist/config/files.js';
import { run } from '../dist/cli/run.js';
import { Back, Cancelled } from '../dist/setup/interaction.js';
import { ModelAccessError } from '../dist/setup/model-discovery.js';
import { navigate } from '../dist/setup/navigation.js';

// Workflow tests never contact a provider unless they inject a discovery fixture.
const noModels = async () => [];
const targets = { recall: async () => undefined, remember: async () => {} };
const setupServer = (ui, options = {}) => runSetupServer(ui, { targets, listModels: noModels, prepareImages: async () => structuredClone(manifest), ...options,
  ...(options.runtime ? { runtime: (...args) => ({ hasProviderAuthorization: async () => true, ...options.runtime(...args) }) } : {}),
});
const serverQuestions = (ui, existing, services, options = {}) => askServerQuestions(ui, existing, services, { listModels: noModels, ...options });

const settings = validateEnv({ LLM_BASE_URL: 'https://provider.test.invalid/v1', MEMORY_PROXY_PUBLIC_URL: 'https://models.test.invalid', KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid', PANEL_PUBLIC_URL: 'https://panel.third.invalid', LLM_API_KEY: 'provider-\'"\\${VALUE}', MEMORY_LLM_MODEL: 'memory-test', KNOWLEDGE_LLM_MODEL: 'wiki-test', CORE_API_KEY: generateKey('core'), CLIPROXY_API_KEY: generateKey('cliproxy') });
const manifest = { schemaVersion: 1, images: Object.fromEntries(['core','knowledge','panel','memory-proxy','cli-proxy-api','mcp','runtime'].map((service, i) => [service, { id: 'sha256:' + String(i + 1).repeat(64), tag: `${service}:test`, platform: 'linux/arm64', repoDigests: [] }])) };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ams-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function interaction(answers = {}) {
  const asked = [], notes = [], handoffs = [], questions = [];
  return { asked, notes, handoffs, questions,
    async text(q) { asked.push(q.id); questions.push(q); const value = answers[q.id] ?? (answers.useDefaults ? q.initial ?? settings[q.id] : settings[q.id] ?? q.initial); assert.equal(typeof value, 'string', q.id); if(q.validate) assert.equal(q.validate(value), undefined, q.id); if(q.secret) assert.equal(q.initial, undefined); return value; },
    async select(id, message, options, initial) { asked.push(id); questions.push({id,message,options,initial}); return answers[id] ?? initial ?? options[0].value; },
    async multiselect(id, message, options, initial) { asked.push(id); questions.push({id,message,options,initial}); return answers[id] ?? initial; },
    async confirm(id, message, initial) { asked.push(id); return answers[id] ?? (id === 'apply' ? true : initial); },
    note(message) { notes.push(message); },
    async handoff(key) { handoffs.push(key); if(answers.cancelHandoff) throw new Cancelled(); },
  };
}
test('Configure stack starts the service workflow', async () => {
  const ui = interaction();
  let calls = 0;
  await run(ui, { configure: async () => { calls++; }, apply: async () => assert.fail('Configure selected') });
  assert.equal(calls, 1);
  assert.deepEqual(ui.asked, ['action']);
});
test('questions retain operational fields and preserve advanced settings without network prompts', async () => {
  const ui = interaction();
  const env = await serverQuestions(ui, settings);
  assert.deepEqual(env, settings);
  for (const name of ['DATA_DIR', 'LLM_BASE_URL', 'MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL', 'MEMORY_PROMPT_MODE', 'LOG_LEVEL']) assert.ok(ui.asked.includes(name), name);
  assert.ok(ui.asked.includes('keep:LLM_API_KEY'));
  assert.ok(!ui.asked.some(id => /CORE_API_KEY|CLIPROXY_API_KEY/.test(id)));
  assert.ok(!ui.asked.some(id => /_PORT$|_PUBLIC_URL$|_MODE$|_ENABLED$|^REMOTE_/.test(id) && id !== 'MEMORY_PROMPT_MODE'));
  assert.match(ui.notes.join('\n'), /Other interfaces stay private/);
});
test('setup defaults to ./ams and saves an absolute target relative to its working directory', async t => {
  const cwd = await fixture(t);
  let remembered;
  const ui = interaction({ apply: false });
  await setupServer(ui, { cwd, targets: { recall: async () => undefined, remember: async (_target, path) => { remembered = path; } } });
  assert.equal(ui.questions.find(q => q.id === 'directory').initial, './ams');
  assert.equal(remembered, join(cwd, 'ams'));
  assert.equal((await readEnv(join(remembered, '.env'))).DATA_DIR, './data');
});
test('setup shows a remembered home path in shorthand before consuming answers', async () => {
  const ui = interaction();
  ui.text = async q => {
    assert.equal(q.id, 'directory');
    assert.equal(q.initial, '~/ams');
    throw new Cancelled();
  };
  await assert.rejects(setupServer(ui, { targets: { recall: async () => join(homedir(), 'ams'), remember: async () => assert.fail('cancelled') } }), Cancelled);
});
test('setup expands home input before writing and shows data paths in shorthand in review', async t => {
  const directory = await fixture(t);
  const destination = join(directory, 'server');
  let remembered;
  const ui = interaction({ directory: `~/${relative(homedir(), destination)}`, DATA_DIR: '~/ams/data', apply: false });
  await setupServer(ui, { targets: { recall: async () => undefined, remember: async (_target, path) => { remembered = path; } } });
  assert.equal(remembered, destination);
  assert.equal((await readEnv(join(destination, '.env'))).DATA_DIR, join(homedir(), 'ams', 'data'));
  assert.ok(ui.notes.some(note => note.includes('DATA_DIR: ~/ams/data')));
  assert.ok(!ui.notes.some(note => note.includes(settings.LLM_API_KEY)));
});
test('data path prompts shorten saved home paths and retain relative installation paths', async () => {
  for (const [path, displayed] of [[homedir(), '~'], [join(homedir(), 'ams', 'data'), '~/ams/data'], ['./data', './data']]) {
    const ui = interaction({ useDefaults: true });
    const env = await serverQuestions(ui, { ...settings, DATA_DIR: path });
    assert.equal(ui.questions.find(q => q.id === 'DATA_DIR').initial, displayed);
    assert.equal(env.DATA_DIR, path);
  }
});
test('CLIProxyAPI account provider defaults to Codex, offers Claude and preserves its saved choice', async () => {
  for (const provider of ['codex', 'claude']) {
    const ui = interaction();
    const env = await serverQuestions(ui, { ...settings, CLIPROXY_AUTH_PROVIDER: provider });
    assert.equal(env.CLIPROXY_AUTH_PROVIDER, provider);
    const question = ui.questions.find(q => q.id === 'CLIPROXY_AUTH_PROVIDER');
    assert.equal(question.initial, provider);
    assert.deepEqual(question.options.map(option => option.label), ['ChatGPT (Codex)', 'Claude']);
  }
  assert.equal(settings.CLIPROXY_AUTH_PROVIDER, 'codex');
  assert.throws(() => validateEnv({ ...settings, CLIPROXY_AUTH_PROVIDER: 'invalid' }), /CLIPROXY_AUTH_PROVIDER/);
});
test('local service keys are generated or reused without questions and invalid saved keys are not replaced', async () => {
  const fresh = interaction();
  const generated = await serverQuestions(fresh, {});
  assert.match(generated.CORE_API_KEY, /^sk-ams-core-[a-f0-9]{64}$/);
  assert.match(generated.CLIPROXY_API_KEY, /^sk-ams-cliproxy-[a-f0-9]{64}$/);
  assert.notEqual(generated.CORE_API_KEY, generated.CLIPROXY_API_KEY);
  assert.ok(!fresh.asked.some(id => /CORE_API_KEY|CLIPROXY_API_KEY/.test(id)));
  const saved = interaction();
  const repeated = await serverQuestions(saved, generated);
  assert.equal(repeated.CORE_API_KEY, generated.CORE_API_KEY);
  assert.equal(repeated.CLIPROXY_API_KEY, generated.CLIPROXY_API_KEY);
  for (const name of ['CORE_API_KEY', 'CLIPROXY_API_KEY']) {
    await assert.rejects(serverQuestions(interaction(), { ...generated, [name]: 'invalid\nkey' }), new RegExp(name));
  }
});
test('output tokens and LLM timeouts use env defaults or saved values without wizard questions', async () => {
  for (const [existing, expectedCore, expectedKnowledge, expectedCoreTimeout, expectedKnowledgeTimeout] of [
    [{}, '32000', '32768', '300000', '1200000'],
    [{ ...settings, MEMORY_LLM_MAX_TOKENS: '8192', KNOWLEDGE_LLM_MAX_TOKENS: '16384', MEMORY_LLM_TIMEOUT_MS: '120000', KNOWLEDGE_LLM_TIMEOUT_MS: '600000' }, '8192', '16384', '120000', '600000'],
  ]) {
    const ui = interaction();
    const env = await serverQuestions(ui, existing);
    assert.equal(env.MEMORY_LLM_MAX_TOKENS, expectedCore);
    assert.equal(env.KNOWLEDGE_LLM_MAX_TOKENS, expectedKnowledge);
    assert.equal(env.MEMORY_LLM_TIMEOUT_MS, expectedCoreTimeout);
    assert.equal(env.KNOWLEDGE_LLM_TIMEOUT_MS, expectedKnowledgeTimeout);
    assert.ok(!ui.asked.includes('MEMORY_LLM_MAX_TOKENS'));
    assert.ok(!ui.asked.includes('KNOWLEDGE_LLM_MAX_TOKENS'));
    assert.ok(!ui.asked.includes('MEMORY_LLM_TIMEOUT_MS'));
    assert.ok(!ui.asked.includes('KNOWLEDGE_LLM_TIMEOUT_MS'));
  }
  for (const name of ['MEMORY_LLM_MAX_TOKENS', 'KNOWLEDGE_LLM_MAX_TOKENS', 'MEMORY_LLM_TIMEOUT_MS', 'KNOWLEDGE_LLM_TIMEOUT_MS']) {
    const ui = interaction();
    await assert.rejects(serverQuestions(ui, { ...settings, [name]: 'invalid' }), new RegExp(name));
    assert.ok(!ui.asked.includes(name));
  }
});
test('server writes reviewed config, keeps admin only in handoff and runtime memory', async t => {
  const dir=await fixture(t); const destination=join(dir,'server'); const calls=[];
  const ui=interaction({directory:destination,provider:'podman-compose'});
  await setupServer(ui,{runtime:()=>({preflight:async()=>{calls.push('preflight');}, apply:async (key, {createAdminKey})=>{assert.equal(key,undefined); calls.push(await createAdminKey());},login:async()=>{calls.push('login');},status:async()=>''})});
  assert.ok(!ui.asked.includes('server-action'));
  assert.ok(!ui.asked.includes('manifest'));
  assert.equal(calls[0],'preflight'); assert.match(calls[1],/^sk-ams-admin-[a-f0-9]{64}$/); assert.equal(ui.handoffs[0],calls[1]);
  for(const name of ['.env','compose.yaml','.ams/images.json','.ams/compose.env','.ams/runtime.json']) assert.ok(!(await readFile(join(destination,name),'utf8')).includes(calls[1]), name);
  assert.ok(!ui.notes.join('\n').includes(calls[1])); assert.ok(!ui.notes.join('\n').includes(settings.LLM_API_KEY));
  assert.equal((await readEnv(join(destination,'.env'))).LLM_API_KEY,settings.LLM_API_KEY);
  assert.ok(!(await readFile(join(destination,'.ams/compose.env'),'utf8')).includes(settings.LLM_API_KEY));
  await assert.rejects(readFile(join(destination,'.admin-key')),{code:'ENOENT'});
});
test('declined apply or cancelled handoff retains saved settings and never initializes Core', async t => {
  const dir=await fixture(t); await mkdir(join(dir,'.ams')); const before=encodeEnv(settings); await writeFile(join(dir,'.env'),before);
  for(const cancellation of [{apply:false},{cancelHandoff:true}]) {
    const ui=interaction({directory:dir,LOG_LEVEL:'warn',...cancellation}); let initialized=false, prepared=false;
    const result = setupServer(ui,{prepareImages:async()=>{prepared=true; return structuredClone(manifest);},runtime:()=>({preflight:async()=>{},apply:async (_key,{createAdminKey})=>{await createAdminKey(); initialized=true;},login:async()=>{},status:async()=>''})});
    if (cancellation.apply === false) await result;
    else await assert.rejects(result, Cancelled);
    assert.equal((await readEnv(join(dir,'.env'))).LOG_LEVEL,'warn'); assert.equal(initialized,false); assert.equal(prepared,cancellation.apply !== false);
  }
});

test('fresh setup prepares the full implemented stack images after approval and before preflight, without a manifest question', async t => {
  const dir = await fixture(t), destination = join(dir, 'fresh');
  const ui = interaction({ directory: destination, provider: 'uvx-podman-compose' });
  const events = [];
  const confirm = ui.confirm;
  ui.confirm = async (...args) => { if (args[0] === 'apply') events.push('approval'); return confirm(...args); };
  ui.commit = () => events.push('commit');
  const selected = structuredClone(manifest);
  await setupServer(ui, {
    prepareImages: async options => {
      events.push('prepare');
      assert.equal(options.projectDir, destination);
      assert.equal(options.runtime, 'podman');
      assert.deepEqual([...options.services].sort(), [...serviceNames, 'runtime'].sort());
      await assert.rejects(readFile(join(destination, '.ams/images.json')), { code: 'ENOENT' });
      return selected;
    },
    runtime: () => ({
      preflight: async images => { events.push('preflight'); assert.deepEqual(images, selected); },
      apply: async (key, { createAdminKey }) => { events.push('apply'); assert.equal(key, undefined); assert.match(await createAdminKey(), /^sk-ams-admin-/); },
      login: async () => assert.fail('not requested'),
    }),
  });
  assert.deepEqual(events, ['commit', 'approval', 'commit', 'prepare', 'preflight', 'apply']);
  assert.ok(!ui.asked.includes('manifest'));
  assert.deepEqual(JSON.parse(await readFile(join(destination, '.ams/images.json'), 'utf8')), selected);
});

test('image preparation failure preserves installed configuration and skips preflight, snapshot and apply', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, '.ams'));
  const before = encodeEnv(settings), images = JSON.stringify(manifest);
  await writeFile(join(dir, '.env'), before);
  await writeFile(join(dir, '.ams/images.json'), images);
  const ui = interaction({ directory: dir });
  await assert.rejects(setupServer(ui, {
    prepareImages: async () => { throw new Error('synthetic build failure'); },
    runtime: () => ({
      preflight: async () => assert.fail('images unavailable'),
      snapshot: async () => assert.fail('images unavailable'),
      apply: async () => assert.fail('images unavailable'),
    }),
  }), /synthetic build failure/);
  assert.equal(await readFile(join(dir, '.env'), 'utf8'), before);
  assert.equal(await readFile(join(dir, '.ams/images.json'), 'utf8'), images);
});
test('saved stack with an active administrator applies without generating or asking for a key',async t=>{
  const dir=await fixture(t); await writeFile(join(dir,'.env'),encodeEnv(settings));
  const ui=interaction({directory:dir}); let key;
  await setupServer(ui,{runtime:()=>({preflight:async()=>{},apply:async (value,{createAdminKey})=>{key=value; assert.equal(typeof createAdminKey,'function');},login:async()=>assert.fail('not requested'),status:async()=>assert.fail('setup must apply')})});
  assert.equal(key,undefined); assert.deepEqual(ui.handoffs,[]); assert.ok(!ui.asked.includes('admin')); assert.ok(!ui.asked.includes('generate:admin'));
  assert.ok(!ui.asked.includes('server-action'));
  assert.equal((await readEnv(join(dir,'.env'))).CORE_API_KEY,settings.CORE_API_KEY);
});
test('service selection derives full defaults or saved topology without a question', async () => {
  const fresh = interaction();
  assert.deepEqual(await selectServices(fresh, {}), serviceNames);
  assert.deepEqual(fresh.asked, []);
  assert.match(fresh.notes.join('\n'), /Core \(memory storage/);
  const saved = interaction();
  assert.deepEqual(await selectServices(saved, { AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'panel,cli-proxy-api' }), ['panel','cli-proxy-api']);
  assert.deepEqual(saved.asked, []);
  await assert.rejects(selectServices(interaction(), { AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: '' }), /AMS_SERVICES.*\.env/);
});

test('standalone CLIProxyAPI asks only its settings and deploys its required subset', async t => {
  const dir = await fixture(t); const destination = join(dir, 'cli-only');
  await mkdir(destination);
  await writeFile(join(destination, '.env'), encodeEnv(validateEnv({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_API_KEY: 'saved-cli-key', CLIPROXY_SERVICE_ENABLED: 'true' })));
  const ui = interaction({ directory: destination });
  let applied;
  await setupServer(ui, { runtime: () => ({
    preflight: async (_manifest, env) => assert.equal(env.AMS_SERVICES, 'cli-proxy-api'),
    apply: async (key, opts) => { applied = opts; assert.equal(key, undefined); }, login: async () => assert.fail('not requested'), status: async () => '',
  }) });
  assert.deepEqual(applied, { allowPending: false, createAdminKey: undefined });
  assert.ok(!ui.asked.includes('server-action'));
  assert.equal(ui.handoffs.length, 0);
  for (const name of ['CORE_API_KEY','LLM_API_KEY','LLM_BASE_URL','MEMORY_LLM_MODEL','KNOWLEDGE_LLM_MODEL','PANEL_PUBLIC_URL','KNOWLEDGE_PUBLIC_URL','generate:admin']) assert.ok(!ui.asked.includes(name), name);
  const compose = parseYaml(await readFile(join(destination, 'compose.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(compose.services).sort(), ['cli-proxy-api', 'config']);
  assert.match(ui.notes.join('\n'), /127\.0\.0\.1:8317 \(authenticated service consumers/);
});

test('saved local CLIProxyAPI can log in after installation without an action menu', async t => {
  const dir = await fixture(t);
  const env = await serverQuestions(interaction(), {}, ['cli-proxy-api']);
  await writeFile(join(dir, '.env'), encodeEnv(env));
  const ui = interaction({ directory: dir,  login: 'codex' });
  const events = [];
  let authorized = false;
  await setupServer(ui, { runtime: () => ({
    hasProviderAuthorization: async () => authorized,
    preflight: async () => { events.push('preflight'); },
    apply: async key => { assert.equal(key, undefined); events.push('apply'); },
    login: async () => { authorized = true; events.push('login'); },
    status: async () => assert.fail('setup must apply'),
  }) });
  assert.deepEqual(events, ['preflight', 'apply', 'login']);
  assert.ok(!ui.asked.includes('server-action'));
  assert.equal(ui.handoffs.length, 0);
});

test('Knowledge reads remote service credentials from .env and reports incomplete dependencies', async () => {
  const existing = { AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'knowledge', REMOTE_CORE_URL: 'https://backend.invalid/core', REMOTE_CORE_API_KEY: 'existing-core-key', REMOTE_PANEL_URL: 'https://callback.invalid/panel' };
  const ui = interaction();
  const env = await serverQuestions(ui, existing);
  assert.equal(env.REMOTE_CORE_API_KEY, 'existing-core-key');
  assert.equal(env.PANEL_MODE, 'remote');
  assert.ok(!ui.asked.some(id => id.startsWith('REMOTE_')));
  await assert.rejects(serverQuestions(interaction(), { ...existing, REMOTE_PANEL_URL: '' }), /\.env:.*REMOTE_PANEL_URL/);
});

test('MemoryProxy preserves saved remote dependencies and inactive local keys', async () => {
  const existing = { ...settings, AMS_SERVICES: 'memory-proxy', CORE_MODE: 'remote', MODEL_MODE: 'remote', KNOWLEDGE_MODE: 'disabled', PANEL_MODE: 'disabled', REMOTE_CORE_URL: 'https://core.invalid', REMOTE_CORE_API_KEY: 'remote-core-key', REMOTE_MODEL_BASE_URL: 'https://model.invalid/v1', REMOTE_MODEL_API_KEY: 'remote-model-key' };
  const ui = interaction();
  const env = await serverQuestions(ui, existing);
  assert.equal(env.CORE_API_KEY, settings.CORE_API_KEY);
  assert.equal(env.CLIPROXY_API_KEY, settings.CLIPROXY_API_KEY);
  assert.equal(env.REMOTE_CORE_API_KEY, 'remote-core-key');
  assert.equal(env.REMOTE_MODEL_API_KEY, 'remote-model-key');
  assert.equal(env.KNOWLEDGE_MODE, 'disabled');
  assert.ok(!ui.asked.some(id => /^REMOTE_|_PUBLIC_URL$|generate:/.test(id)));
});

test('public origins follow saved ports when absent and preserve explicit external origins without questions', async () => {
  const fresh = interaction({ useDefaults: true });
  const env = await serverQuestions(fresh, { MEMORY_PROXY_PORT: '28096' });
  assert.equal(env.MEMORY_PROXY_PUBLIC_URL, 'http://127.0.0.1:28096');
  assert.ok(!fresh.asked.includes('MEMORY_PROXY_PORT'));
  assert.ok(!fresh.asked.includes('MEMORY_PROXY_PUBLIC_URL'));
  const saved = interaction({ useDefaults: true });
  const repeat = await serverQuestions(saved, { ...settings, MEMORY_PROXY_PORT: '28097', CORE_SERVICE_ENABLED: 'true', KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' });
  assert.equal(repeat.MEMORY_PROXY_PUBLIC_URL, settings.MEMORY_PROXY_PUBLIC_URL);
  assert.equal(repeat.CORE_SERVICE_ENABLED, 'true');
  assert.equal(repeat.KNOWLEDGE_TOOLS_PUBLIC_ENABLED, 'true');
});

test('provider endpoint questions show the example only as a placeholder and preserve saved endpoints', async () => {
  const fresh = interaction();
  await serverQuestions(fresh, {});
  const question = fresh.questions.find(item => item.id === 'LLM_BASE_URL');
  assert.equal(question.initial, undefined);
  assert.equal(question.placeholder, 'https://api.example.com/v1');
  assert.ok(question.validate(''));
  const saved = interaction();
  await serverQuestions(saved, settings);
  assert.equal(saved.questions.find(item => item.id === 'LLM_BASE_URL').initial, settings.LLM_BASE_URL);
});

test('Core and Knowledge select from one discovery after the provider URL and key are entered', async () => {
  const ui = interaction({ MEMORY_LLM_MODEL: 'model:1', KNOWLEDGE_LLM_MODEL: 'model:0' });
  const calls = [];
  const env = await serverQuestions(ui, {}, serviceNames, { listModels: async (...args) => { calls.push(args); return ['first-model', 'second-model']; } });
  assert.deepEqual(calls, [[settings.LLM_BASE_URL, settings.LLM_API_KEY]]);
  assert.equal(env.MEMORY_LLM_MODEL, 'second-model');
  assert.equal(env.KNOWLEDGE_LLM_MODEL, 'first-model');
  const question = ui.questions.find(item => item.id === 'MEMORY_LLM_MODEL');
  assert.deepEqual(question.options.map(item => item.label), ['first-model', 'second-model', 'Enter a model manually']);
  assert.ok(ui.asked.indexOf('LLM_API_KEY') < ui.asked.indexOf('MEMORY_LLM_MODEL'));
});

test('unavailable or empty model discovery falls back once to the original model inputs', async () => {
  for (const fail of [false, true]) {
    const ui = interaction(); let calls = 0;
    const env = await serverQuestions(ui, {}, serviceNames, { listModels: async () => { calls++; if (fail) throw new Error(settings.LLM_API_KEY); return []; } });
    assert.equal(calls, 1);
    assert.equal(env.MEMORY_LLM_MODEL, settings.MEMORY_LLM_MODEL);
    assert.equal(env.KNOWLEDGE_LLM_MODEL, settings.KNOWLEDGE_LLM_MODEL);
    assert.equal(ui.questions.find(item => item.id === 'MEMORY_LLM_MODEL').options, undefined);
    assert.ok(!ui.notes.join('\n').includes(settings.LLM_API_KEY));
  }
});

test('API access rejection retries the key without keeping the rejected value or falling back to manual models', async () => {
  for (const saved of [false, true]) {
    const calls = [];
    const ui = interaction({ 'LLM_API_KEY:retry:0': settings.LLM_API_KEY, 'LLM_API_KEY:retry:1': 'corrected-key', MEMORY_LLM_MODEL: 'model:0', KNOWLEDGE_LLM_MODEL: 'model:0' });
    const env = await navigate(ui, questions => serverQuestions(questions, saved ? settings : {}, serviceNames, {
      listModels: async (url, key) => {
        calls.push([url, key]);
        if (key !== 'corrected-key') throw new ModelAccessError(calls.length === 1 ? 401 : 403);
        return ['available-model'];
      },
    }));
    assert.deepEqual(calls.map(call => call[1]), [settings.LLM_API_KEY, settings.LLM_API_KEY, 'corrected-key']);
    assert.equal(env.LLM_API_KEY, 'corrected-key');
    assert.equal(env.MEMORY_LLM_MODEL, 'available-model');
    assert.equal(env.KNOWLEDGE_LLM_MODEL, 'available-model');
    for (const q of ui.questions.filter(q => q.id.startsWith('LLM_API_KEY:retry:'))) {
      assert.equal(q.secret, true); assert.equal(q.initial, undefined);
      assert.doesNotMatch(q.message, /keep/); assert.ok(q.validate(''));
    }
    assert.equal(ui.asked.filter(id => id === 'LLM_BASE_URL').length, 1);
    assert.doesNotMatch(ui.notes.join('\n'), /Enter the model names manually/);
    assert.ok(!ui.notes.join('\n').includes(settings.LLM_API_KEY));
  }
});

test('cancelling API key retry exits setup instead of falling back to manual models', async () => {
  const ui = interaction(); const text = ui.text;
  ui.text = async q => { if (q.id.startsWith('LLM_API_KEY:retry:')) throw new Cancelled(); return text(q); };
  await assert.rejects(serverQuestions(ui, {}, ['core'], { listModels: async () => { throw new ModelAccessError(401); } }), Cancelled);
  assert.ok(!ui.asked.includes('MEMORY_LLM_MODEL'));
});

test('Escape after a corrected key preserves that correction and cached models', async () => {
  const ui = interaction(); const text = ui.text; const select = ui.select;
  let keyVisits = 0, modelVisits = 0, discoveries = 0;
  ui.text = async q => {
    if (q.id.startsWith('LLM_API_KEY:retry:')) {
      if (keyVisits++ === 0) return 'corrected-key';
      assert.match(q.message, /Enter to keep the previous value/);
      return '';
    }
    return text(q);
  };
  ui.select = async (...args) => {
    if (args[0] === 'MEMORY_LLM_MODEL' && modelVisits++ === 0) throw new Back();
    return select(...args);
  };
  const env = await navigate(ui, questions => serverQuestions(questions, {}, ['core'], { listModels: async (_url, key) => {
    discoveries++;
    if (key !== 'corrected-key') throw new ModelAccessError(401);
    return ['available-model'];
  } }));
  assert.equal(env.LLM_API_KEY, 'corrected-key');
  assert.equal(keyVisits, 2); assert.equal(discoveries, 2);
  assert.equal(ui.asked.filter(id => id === 'LLM_BASE_URL').length, 1);
});

test('saved models outside the list remain selected and manual entry stays available', async () => {
  const saved = interaction();
  const kept = await serverQuestions(saved, { ...settings, AMS_SERVICES: 'core', MODEL_MODE: 'disabled', KNOWLEDGE_MODE: 'disabled', PANEL_MODE: 'disabled', PROXY_MODE: 'disabled' }, ['core'], { listModels: async () => ['listed-model'] });
  assert.equal(kept.MEMORY_LLM_MODEL, settings.MEMORY_LLM_MODEL);
  assert.equal(saved.questions.find(item => item.id === 'MEMORY_LLM_MODEL').initial, 'saved');
  const manual = interaction({ MEMORY_LLM_MODEL: 'custom-model' });
  const select = manual.select;
  manual.select = async (...args) => args[0] === 'MEMORY_LLM_MODEL' ? 'manual' : select(...args);
  const entered = await serverQuestions(manual, {}, ['core'], { listModels: async () => ['listed-model'] });
  assert.equal(entered.MEMORY_LLM_MODEL, 'custom-model');
});

test('unused providers are not queried and cancelling a model select stops setup', async () => {
  await serverQuestions(interaction(), {}, ['cli-proxy-api'], { listModels: async () => assert.fail('unused provider query') });
  const ui = interaction(); const select = ui.select;
  ui.select = async (...args) => { if (args[0] === 'MEMORY_LLM_MODEL') throw new Cancelled(); return select(...args); };
  await assert.rejects(serverQuestions(ui, {}, ['core'], { listModels: async () => ['listed-model'] }), Cancelled);
});

test('reviewed removals and declined staged start retain desired settings and preserve applied inventory', async t => {
  const dir = await fixture(t); await mkdir(join(dir, '.ams')); const before = encodeEnv(validateEnv({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_API_KEY: settings.CLIPROXY_API_KEY }));
  await writeFile(join(dir, '.env'), before);
  const inventory = JSON.stringify({ version: 1, services: resolveDeployment(settings).containers });
  await writeFile(join(dir, '.ams/applied.json'), inventory);
  for (const cancellation of [{ apply: false }, { 'staged-start': false }]) {
    const ui = interaction({ directory: dir, ...cancellation });
    let applied = false;
    const result = setupServer(ui, { runtime: () => ({ preflight: async () => ({ pending: ['Remote peer unavailable'] }),
      apply: async () => { applied = true; }, login: async () => assert.fail('not requested'), status: async () => '',
    }) });
    if (cancellation.apply === false) await result;
    else await assert.rejects(result, Cancelled);
    assert.equal(applied, false);
    assert.equal((await readEnv(join(dir,'.env'))).AMS_SERVICES, 'cli-proxy-api');
    assert.equal(await readFile(join(dir,'.ams/applied.json'),'utf8'), inventory);
    assert.match(ui.notes.join('\n'), /Removed containers: .*core/);
    assert.ok(!ui.notes.join('\n').includes(settings.CORE_API_KEY));
  }
});

test('remote CLIProxyAPI setup has no action menu or local login prompt', async t => {
  const dir = await fixture(t);
  const env = await serverQuestions(interaction(), { REMOTE_CORE_URL:'https://core.invalid', REMOTE_CORE_API_KEY:'core-remote', REMOTE_MODEL_BASE_URL:'https://model.invalid/v1', REMOTE_MODEL_API_KEY:'model-remote' }, ['memory-proxy']);
  await writeFile(join(dir,'.env'), encodeEnv(env));
  const ui = interaction({ directory:dir });
  await setupServer(ui, { runtime: () => ({ preflight:async()=>{}, apply:async key=>assert.equal(key,undefined), login:async()=>assert.fail('remote login forbidden'), status:async()=>'' }) });
  assert.ok(!ui.asked.includes('server-action'));
  assert.ok(!ui.asked.includes('generate:admin'));
  assert.ok(!ui.asked.includes('login'));
});

test('configuration snapshot preserves previous applied inputs after desired settings were saved', async t => {
  const dir = await fixture(t); const before = encodeEnv(settings);
  await writeFile(join(dir, '.env'), before);
  await mkdir(join(dir, '.ams'));
  const oldImages = JSON.stringify({ schemaVersion: 1, images: { core: manifest.images.core } });
  await writeFile(join(dir, '.ams/images.json'), oldImages);
  const events = [];
  const ui = interaction({ directory:dir, LOG_LEVEL:'warn' });
  const handoff = ui.handoff;
  ui.handoff = async key => { events.push('handoff'); await handoff(key); };
  await setupServer(ui, { runtime: () => ({
    preflight: async () => { events.push('preflight'); },
    snapshot: async input => {
      events.push('snapshot'); assert.deepEqual(input,manifest);
      assert.equal((await readEnv(join(dir,'.env'))).LOG_LEVEL,'warn');
      assert.equal(await readFile(join(dir,'.ams/images.json'),'utf8'),oldImages);
    },
    apply: async (_key, { createAdminKey }) => { events.push('apply'); await createAdminKey(); assert.equal((await readEnv(join(dir,'.env'))).LOG_LEVEL,'warn'); },
    login: async () => assert.fail('not requested'), status: async () => '',
  }) });
  assert.deepEqual(events,['preflight','snapshot','apply','handoff']);
  assert.equal(await readFile(join(dir,'.ams/previous-settings/.env'),'utf8'), before);
});

test('Escape returns from provider to directory without restoring removed service questions', async t => {
  const dir = await fixture(t);
  const ui = interaction({ directory:join(dir,'server'), apply:false });
  const select = ui.select;
  let providerVisits = 0;
  ui.select = async (...args) => {
    if (args[0] === 'provider' && providerVisits++ === 0) throw new Back();
    return select(...args);
  };
  ui.multiselect = async () => assert.fail('service selection is not interactive');
  await run(ui, { apply: async () => assert.fail('Configure selected'), configure: questions => setupServer(questions, { runtime: () => ({
    preflight: async () => assert.fail('review not approved'), apply: async () => assert.fail('review not approved'),
  }) }) });
  assert.equal(providerVisits, 2);
  assert.equal(ui.asked.filter(id => id === 'directory').length, 2);
  assert.equal((await readEnv(join(dir,'server','.env'))).AMS_SERVICES, serviceNames.join(','));
});

test('post-apply Escape cannot repeat configuration saves, image preparation or installation', async t => {
  const dir = await fixture(t), destination = join(dir,'server');
  const ui = interaction({ directory:destination });
  let discovery = 0, preflight = 0, snapshots = 0, applied = 0, prepared = 0;
  let coreKey, adminKey;
  const shownKeys = [];
  ui.handoff = async key => { shownKeys.push(key); };
  const select = ui.select;
  ui.select = async (...args) => { if (args[0] === 'login') throw new Back(); return select(...args); };
  await assert.rejects(run(ui, { apply: async () => assert.fail('Configure selected'), configure: questions => setupServer(questions, {
    listModels: async () => { discovery++; return []; },
    prepareImages: async () => { prepared++; return structuredClone(manifest); },
    runtime: () => ({
      preflight: async (_images, env) => { preflight++; coreKey = env.CORE_API_KEY; },
      snapshot: async () => { snapshots++; },
      apply: async (_key, { createAdminKey }) => { applied++; adminKey = await createAdminKey(); },
      hasProviderAuthorization: async () => false,
      login: async () => assert.fail('login cancelled'),
    }),
  }) }), Cancelled);
  assert.equal(discovery, 1);
  assert.equal(prepared, 1);
  assert.equal(preflight, 1);
  assert.equal(snapshots, 1);
  assert.equal(applied, 1);
  assert.deepEqual(shownKeys, [adminKey]);
  const env = await readEnv(join(destination,'.env'));
  assert.equal(env.CORE_API_KEY, coreKey);
  assert.ok(!(await readFile(join(destination,'.env'),'utf8')).includes(adminKey));
});
