import { installNativeSourceFixture } from './fixtures/native-source.mjs';
import { readInstallationEnv, orchestrationEnv, readNativeDocuments } from '../dist/config/native-state.js';
async function readEnv(path) { return readInstallationEnv(dirname(path)); }
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { setupServer as runSetupServer } from '../dist/setup/server.js';
import { serverQuestions as askServerQuestions } from '../dist/setup/questions.js';
import { resolveDeployment, serviceNames } from '../dist/deployment/model.js';
import { fields, generateKey, resolveSettings } from '../dist/config/settings.js';
import { encodeEnv } from '../dist/config/files.js';
import { run } from '../dist/cli/run.js';
import { Back, Cancelled } from '../dist/setup/interaction.js';
import { ModelAccessError } from '../dist/setup/model-discovery.js';
import { navigate } from '../dist/setup/navigation.js';

// Workflow tests never contact a provider unless they inject a discovery fixture.
const noModels = async () => [];
const setupServer = async (ui, options = {}) => {
  assert.ok(options.directory, 'Workflow tests must inject an isolated configuration directory');
  await installNativeSourceFixture(options.directory);
  return runSetupServer(ui, { listModels: noModels, prepareImages: async () => structuredClone(manifest), ...options,
    ...(options.runtime ? { runtime: (...args) => ({ hasProviderAuthorization: async () => true, ...options.runtime(...args) }) } : {}),
  });
};
const serverQuestions = (ui, existing, options = {}) => askServerQuestions(ui, existing, { listModels: noModels, ...options });

const settings = resolveSettings({ LLM_BASE_URL: 'https://provider.test.invalid/v1', MEMORY_PROXY_PUBLIC_URL: 'https://models.test.invalid', KNOWLEDGE_PUBLIC_URL: 'https://wiki.other.invalid', PANEL_PUBLIC_URL: 'https://panel.third.invalid', LLM_API_KEY: 'provider-\'"\\${VALUE}', MEMORY_LLM_MODEL: 'memory-test', KNOWLEDGE_LLM_MODEL: 'wiki-test', CORE_API_KEY: generateKey('core'), CLIPROXY_API_KEY: generateKey('cliproxy') });
const manifest = { schemaVersion: 1, images: Object.fromEntries(['core','knowledge','panel','memory-proxy','cli-proxy-api','mcp','runtime'].map((service, i) => [service, { id: 'sha256:' + String(i + 1).repeat(64), tag: `${service}:test`, platform: 'linux/arm64', repoDigests: [] }])) };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ams-setup-'));
  process.env.XDG_CONFIG_HOME = join(dir, 'xdg');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function interaction(answers = {}) {
  // These workflow fixtures exercise the external-provider path; shared-mode defaults live in internal-source-setup.test.mjs.
  answers = { INTERNAL_LLM_SOURCE: 'external', ...answers };
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
test('first apply fills deferred native origins from the allocated ports', async t => {
  const dir = await fixture(t);
  await setupServer(interaction(), { directory: dir, runtime: () => ({
    preflight: async () => ({ pending: [] }),
    reservePorts: async () => ({ ports: { MEMORY_PROXY_PORT: '29096', PANEL_PORT: '29123' }, release: async () => {} }),
    apply: async () => {}, login: async () => assert.fail('authorization already available'),
  }) });
  const documents = await readNativeDocuments(dir);
  assert.equal(parseYaml(documents['proxy.yaml']).injection.externalGatewayUrl, 'http://127.0.0.1:29096');
  assert.equal(JSON.parse(documents['panel-instances.json']).instances[0].proxy_endpoint, 'http://127.0.0.1:29096');
});
test('questions retain operational fields and preserve advanced settings without network prompts', async () => {
  const ui = interaction();
  const env = await serverQuestions(ui, settings);
  assert.deepEqual(env, { ...settings, MEMORY_PROMPT_MODE: 'code' });
  for (const name of ['LLM_BASE_URL', 'MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL', 'MEMORY_PROMPT_MODE', 'LOG_LEVEL']) assert.ok(ui.asked.includes(name), name);
  assert.ok(ui.asked.includes('keep:LLM_API_KEY'));
  assert.ok(!ui.asked.some(id => /CORE_API_KEY|CLIPROXY_API_KEY/.test(id)));
  assert.ok(!ui.asked.some(id => /_PORT$|_PUBLIC_URL$|_MODE$|_ENABLED$|^REMOTE_/.test(id) && id !== 'MEMORY_PROMPT_MODE'));
  assert.match(ui.notes.join('\n'), /Other interfaces stay private/);
});
test('setup writes into its configured directory without directory or data-path questions', async t => {
  const directory = await fixture(t);
  const ui = interaction({ apply: false });
  await setupServer(ui, { directory });
  assert.equal((await readEnv(join(directory, '.env'))).DATA_DIR, './data');
  assert.ok(!ui.asked.includes('directory'));
  assert.ok(!ui.asked.includes('DATA_DIR'));
});
test('setup preserves saved data paths and shortens home paths in review', async t => {
  const directory = await fixture(t);
  await writeFile(join(directory, '.env'), encodeEnv({ ...settings, DATA_DIR: join(homedir(), 'ams', 'data') }));
  const ui = interaction({ apply: false });
  await setupServer(ui, { directory });
  assert.equal((await readEnv(join(directory, '.env'))).DATA_DIR, join(homedir(), 'ams', 'data'));
  assert.ok(ui.notes.some(note => note.includes('DATA_DIR: ~/ams/data')));
  assert.ok(!ui.notes.some(note => note.includes(settings.LLM_API_KEY)));
});
test('data paths are retained without questions for absolute and relative installation paths', async () => {
  for (const path of [homedir(), join(homedir(), 'ams', 'data'), './data']) {
    const ui = interaction({ useDefaults: true });
    const env = await serverQuestions(ui, { ...settings, DATA_DIR: path });
    assert.ok(!ui.asked.includes('DATA_DIR'));
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
  assert.equal(resolveSettings({ ...settings, CLIPROXY_AUTH_PROVIDER: 'custom' }).CLIPROXY_AUTH_PROVIDER, 'custom');
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
    assert.equal((await serverQuestions(interaction(), { ...generated, [name]: 'arbitrary\nkey' }))[name], 'arbitrary\nkey');
  }
});
test('output tokens and LLM timeouts inherit native defaults or retain saved values without wizard questions', async () => {
  for (const [existing, expectedCore, expectedKnowledge, expectedCoreTimeout, expectedKnowledgeTimeout] of [
    [{}, undefined, undefined, undefined, undefined],
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
    assert.equal((await serverQuestions(ui, { ...settings, [name]: 'custom-value' }))[name], 'custom-value');
    assert.ok(!ui.asked.includes(name));
  }
});
test('server writes reviewed config, keeps admin only in handoff and runtime memory', async t => {
  const dir=await fixture(t); const destination=join(dir,'server'); const calls=[];
  const ui=interaction({ provider:'podman-compose'});
  await setupServer(ui,{directory:destination,runtime:()=>({preflight:async()=>{calls.push('preflight');}, apply:async (key, {createAdminKey})=>{assert.equal(key,undefined); calls.push(await createAdminKey());},login:async()=>{calls.push('login');},status:async()=>''})});
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
    const ui=interaction({ LOG_LEVEL:'warn',...cancellation}); let initialized=false, prepared=false;
    const result = setupServer(ui,{directory:dir,prepareImages:async()=>{prepared=true; return structuredClone(manifest);},runtime:()=>({preflight:async()=>{},apply:async (_key,{createAdminKey})=>{await createAdminKey(); initialized=true;},login:async()=>{},status:async()=>''})});
    if (cancellation.apply === false) await result;
    else await assert.rejects(result, Cancelled);
    assert.equal((await readEnv(join(dir,'.env'))).LOG_LEVEL,'warn'); assert.equal(initialized,false); assert.equal(prepared,cancellation.apply !== false);
  }
});

test('fresh setup prepares the full implemented stack images after approval and before preflight, without a manifest question', async t => {
  const dir = await fixture(t), destination = join(dir, 'fresh');
  const ui = interaction({ provider: 'uvx-podman-compose' });
  const events = [];
  const confirm = ui.confirm;
  ui.confirm = async (...args) => { if (args[0] === 'apply') events.push('approval'); return confirm(...args); };
  ui.commit = () => events.push('commit');
  const selected = structuredClone(manifest);
  await setupServer(ui, {
    directory: destination,
    prepareImages: async options => {
      events.push('prepare');
      assert.equal(options.projectDir, destination);
      assert.equal(options.runtime, 'podman');
      assert.ok(!Object.hasOwn(options, 'services'));
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
  const ui = interaction();
  await assert.rejects(setupServer(ui, {
    directory: dir,
    prepareImages: async () => { throw new Error('synthetic build failure'); },
    runtime: () => ({
      preflight: async () => assert.fail('images unavailable'),
      snapshot: async () => assert.fail('images unavailable'),
      apply: async () => assert.fail('images unavailable'),
    }),
  }), /synthetic build failure/);
  assert.equal(await readFile(join(dir, '.env'), 'utf8'), encodeEnv(orchestrationEnv(settings)));
  assert.equal((await readEnv(join(dir, '.env'))).CORE_API_KEY, settings.CORE_API_KEY);
  assert.equal(await readFile(join(dir, '.ams/images.json'), 'utf8'), images);
});
test('saved stack with an active administrator applies without generating or asking for a key',async t=>{
  const dir=await fixture(t); await writeFile(join(dir,'.env'),encodeEnv(settings));
  const ui=interaction(); let key;
  await setupServer(ui,{directory:dir,runtime:()=>({preflight:async()=>{},apply:async (value,{createAdminKey})=>{key=value; assert.equal(typeof createAdminKey,'function');},login:async()=>assert.fail('not requested'),status:async()=>assert.fail('setup must apply')})});
  assert.equal(key,undefined); assert.deepEqual(ui.handoffs,[]); assert.ok(!ui.asked.includes('admin')); assert.ok(!ui.asked.includes('generate:admin'));
  assert.ok(!ui.asked.includes('server-action'));
  assert.equal((await readEnv(join(dir,'.env'))).CORE_API_KEY,settings.CORE_API_KEY);
});
test('saved local CLIProxyAPI can log in after installation without an action menu', async t => {
  const dir = await fixture(t);
  const env = await serverQuestions(interaction(), {});
  await writeFile(join(dir, '.env'), encodeEnv(env));
  const ui = interaction();
  const events = [];
  let authorized = false;
  await setupServer(ui, { directory: dir, runtime: () => ({
    hasProviderAuthorization: async () => authorized,
    preflight: async () => { events.push('preflight'); },
    apply: async key => { assert.equal(key, undefined); events.push('apply'); },
    login: async () => { authorized = true; events.push('login'); },
    status: async () => assert.fail('setup must apply'),
  }) });
  assert.deepEqual(events, ['preflight', 'apply', 'login']);
  assert.equal(ui.asked.filter(id => id === 'CLIPROXY_AUTH_PROVIDER').length, 1);
  assert.ok(!ui.asked.includes('login'));
  assert.ok(!ui.asked.includes('server-action'));
  assert.equal(ui.handoffs.length, 0);
});

test('native origins wait for first apply and retain explicit values without questions', async () => {
  const fresh = interaction({ useDefaults: true });
  const env = await serverQuestions(fresh, { MEMORY_PROXY_PORT: '28096' });
  assert.equal(env.MEMORY_PROXY_PUBLIC_URL, undefined);
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
  assert.equal(question.validate, undefined);
  const saved = interaction();
  await serverQuestions(saved, settings);
  assert.equal(saved.questions.find(item => item.id === 'LLM_BASE_URL').initial, settings.LLM_BASE_URL);
});

test('Core and Knowledge select from one discovery after the provider URL and key are entered', async () => {
  const ui = interaction({ MEMORY_LLM_MODEL: 'model:1', KNOWLEDGE_LLM_MODEL: 'model:0' });
  const calls = [];
  const env = await serverQuestions(ui, {}, { listModels: async (...args) => { calls.push(args); return ['first-model', 'second-model']; } });
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
    const env = await serverQuestions(ui, {}, { listModels: async () => { calls++; if (fail) throw new Error(settings.LLM_API_KEY); return []; } });
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
    const env = await navigate(ui, questions => serverQuestions(questions, saved ? settings : {}, {
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
      assert.doesNotMatch(q.message, /keep/); assert.equal(q.validate, undefined);
    }
    assert.equal(ui.asked.filter(id => id === 'LLM_BASE_URL').length, 1);
    assert.doesNotMatch(ui.notes.join('\n'), /Enter the model names manually/);
    assert.ok(!ui.notes.join('\n').includes(settings.LLM_API_KEY));
  }
});

test('cancelling API key retry exits setup instead of falling back to manual models', async () => {
  const ui = interaction(); const text = ui.text;
  ui.text = async q => { if (q.id.startsWith('LLM_API_KEY:retry:')) throw new Cancelled(); return text(q); };
  await assert.rejects(serverQuestions(ui, {}, { listModels: async () => { throw new ModelAccessError(401); } }), Cancelled);
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
  const env = await navigate(ui, questions => serverQuestions(questions, {}, { listModels: async (_url, key) => {
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
  const kept = await serverQuestions(saved, settings, { listModels: async () => ['listed-model'] });
  assert.equal(kept.MEMORY_LLM_MODEL, settings.MEMORY_LLM_MODEL);
  assert.equal(saved.questions.find(item => item.id === 'MEMORY_LLM_MODEL').initial, 'saved');
  const manual = interaction({ MEMORY_LLM_MODEL: 'custom-model' });
  const select = manual.select;
  manual.select = async (...args) => args[0] === 'MEMORY_LLM_MODEL' ? 'manual' : select(...args);
  const entered = await serverQuestions(manual, {}, { listModels: async () => ['listed-model'] });
  assert.equal(entered.MEMORY_LLM_MODEL, 'custom-model');
});

test('cancelling a model select stops setup', async () => {
  const ui = interaction(); const select = ui.select;
  ui.select = async (...args) => { if (args[0] === 'MEMORY_LLM_MODEL') throw new Cancelled(); return select(...args); };
  await assert.rejects(serverQuestions(ui, {}, { listModels: async () => ['listed-model'] }), Cancelled);
});

test('configuration snapshot preserves previous applied inputs after desired settings were saved', async t => {
  const dir = await fixture(t); const before = encodeEnv(settings);
  await writeFile(join(dir, '.env'), before);
  await mkdir(join(dir, '.ams'));
  const oldImages = JSON.stringify({ schemaVersion: 1, images: { core: manifest.images.core } });
  await writeFile(join(dir, '.ams/images.json'), oldImages);
  const events = [];
  const ui = interaction({ LOG_LEVEL:'warn' });
  const handoff = ui.handoff;
  ui.handoff = async key => { events.push('handoff'); await handoff(key); };
  await setupServer(ui, { directory: dir, runtime: () => ({
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

test('Escape returns from provider to the action menu without introducing directory questions', async t => {
  const dir = await fixture(t);
  const ui = interaction({ apply:false });
  const select = ui.select;
  let providerVisits = 0;
  ui.select = async (...args) => {
    if (args[0] === 'provider' && providerVisits++ === 0) throw new Back();
    return select(...args);
  };
  ui.multiselect = async () => assert.fail('service selection is not interactive');
  await run(ui, { apply: async () => assert.fail('Configure selected'), configure: questions => setupServer(questions, { directory: join(dir, 'server'), runtime: () => ({
    preflight: async () => assert.fail('review not approved'), apply: async () => assert.fail('review not approved'),
  }) }) });
  assert.equal(providerVisits, 2);
  assert.ok(!ui.asked.includes('directory'));
  assert.equal(ui.asked.filter(id => id === 'action').length, 2);
  assert.deepEqual(resolveDeployment(await readEnv(join(dir,'server','.env'))).services, serviceNames);
});

test('post-apply login cancellation cannot repeat configuration saves, image preparation or installation', async t => {
  const dir = await fixture(t), destination = join(dir,'server');
  const ui = interaction();
  let discovery = 0, preflight = 0, snapshots = 0, applied = 0, prepared = 0;
  let coreKey, adminKey;
  const shownKeys = [];
  ui.handoff = async key => { shownKeys.push(key); };
  await assert.rejects(run(ui, { apply: async () => assert.fail('Configure selected'), configure: questions => setupServer(questions, {
    directory: destination,
    listModels: async () => { discovery++; return []; },
    prepareImages: async () => { prepared++; return structuredClone(manifest); },
    runtime: () => ({
      preflight: async (_images, env) => { preflight++; coreKey = env.CORE_API_KEY; },
      snapshot: async () => { snapshots++; },
      apply: async (_key, { createAdminKey }) => { applied++; adminKey = await createAdminKey(); },
      hasProviderAuthorization: async () => false,
      login: async () => { throw new Cancelled(); },
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
