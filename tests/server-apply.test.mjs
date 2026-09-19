import { installNativeSourceFixture } from './fixtures/native-source.mjs';
import { readInstallationEnv, captureNativeConfiguration, readNativeDocuments } from '../dist/config/native-state.js';
async function readEnv(path) { return readInstallationEnv(dirname(path)); }
import test from 'node:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { setupServer, applyServer } from '../dist/setup/server.js';
import { encodeEnv, decodeEnv } from '../dist/config/files.js';
import { resolveSettings } from '../dist/config/settings.js';
import { snapshotSettings } from '../dist/runtime/snapshot.js';
import { Cancelled } from '../dist/setup/interaction.js';
import { serviceNames, resolveDeployment } from '../dist/deployment/model.js';
import { PortBindingConflict } from '../dist/runtime/errors.js';

const images = { schemaVersion: 1, images: Object.fromEntries([...serviceNames, 'runtime'].map((name, i) => [name, {
  id: 'sha256:' + String(i + 1).repeat(64), tag: `${name}:test`, platform: 'linux/arm64', repoDigests: [],
}])) };
const defaults = { LLM_BASE_URL: 'https://provider.invalid/v1', LLM_API_KEY: 'provider-secret', MEMORY_LLM_MODEL: 'memory-model', KNOWLEDGE_LLM_MODEL: 'knowledge-model' };
function ui(answers = {}) {
  answers = { INTERNAL_LLM_SOURCE: 'external', ...answers };
  return {
    asked: [], notes: [], handoffs: [],
    async text(q) { this.asked.push(q.id); const value = answers[q.id] ?? q.initial ?? defaults[q.id]; assert.equal(typeof value, 'string', q.id); assert.equal(q.validate?.(value), undefined, q.id); return value; },
    async select(id, _label, choices, initial) { this.asked.push(id); return answers[id] ?? initial ?? choices[0].value; },
    async multiselect(id, _label, _choices, initial) { this.asked.push(id); return answers[id] ?? initial; },
    async confirm(id, message, initial) { this.asked.push(id); if (id === 'apply') { assert.equal(message, 'Apply configuration now?'); assert.equal(initial, true); } return answers[id] ?? initial; },
    note(message) { this.notes.push(message); },
    async handoff(key) { this.handoffs.push(key); if (answers.cancelHandoff) throw new Cancelled(); },
  };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ams-save-apply-'));
  await installNativeSourceFixture(dir);
  process.env.XDG_CONFIG_HOME = join(dir, 'xdg');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir };
}
function forbidden() { assert.fail('Save-only must not invoke runtime or image preparation'); }
async function save(f, answers = {}, options = {}) {
  let previous = {};
  try { previous = decodeEnv(await readFile(join(f.dir, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const settings = { CLIPROXY_SERVICE_ENABLED: 'true', ...previous };
  for (const [key, value] of Object.entries(answers)) if (/^(?:CLIPROXY_SERVICE_PORT|CLIPROXY_SERVICE_ENABLED)$/.test(key)) settings[key] = String(value);
  if (!Object.keys(previous).length || answers.CLIPROXY_SERVICE_PORT || answers.CLIPROXY_SERVICE_ENABLED !== undefined) {
    await writeFile(join(f.dir, '.env'), encodeEnv(settings));
  }
  const questions = ui({ apply: false, ...answers });
  await setupServer(questions, { directory: f.dir, runtime: forbidden, prepareImages: forbidden, listModels: async () => [], ...options });
  return questions;
}
function runtime(dir, overrides = {}) {
  return {
    hasProviderAuthorization: async () => true,
    preflight: async () => ({ pending: [] }),
    snapshot: async () => snapshotSettings(dir),
    apply: async () => { await rm(join(dir, '.ams/apply-pending'), { force: true }); },
    login: async () => assert.fail('No login requested'),
    status: async () => '',
    ...overrides,
  };
}

test('No saves a fresh full-stack configuration without directory, engine or admin prompts', async t => {
  const f = await fixture(t);
  const questions = await save(f, { provider: 'podman-compose' });
  const env = await readEnv(join(f.dir, '.env'));
  assert.deepEqual(resolveDeployment(env).services, serviceNames);
  const native = JSON.parse(await captureNativeConfiguration(f.dir));
  assert.deepEqual(Object.keys(native.defaults).sort(), ['core.yaml', 'knowledge.env', 'panel-instances.json', 'panel.env', 'proxy.yaml']);
  assert.deepEqual(Object.keys(native.overrides).sort(), Object.keys(native.defaults).sort());
  const proxy = parseYaml((await readNativeDocuments(f.dir))['proxy.yaml']);
  assert.match(proxy.admin.apiKey, /^sk-ams-proxy-admin-[a-f0-9]{64}$/);
  assert.ok(!Object.hasOwn(env, 'AMS_SERVICES'));
  assert.ok(!Object.hasOwn(env, 'AMS_DEPLOYMENT_VERSION'));
  assert.equal(env.LLM_API_KEY, 'provider-secret');
  assert.deepEqual(JSON.parse(await readFile(join(f.dir, '.ams/runtime.json'), 'utf8')), { provider: 'podman-compose' });
  assert.ok(!questions.asked.includes('directory'));
  assert.ok(!questions.asked.includes('admin'));
  assert.ok(!questions.asked.includes('generate:admin'));
  assert.deepEqual(questions.handoffs, []);
  assert.match(questions.notes.join('\n'), /Configuration saved.*\nApply it later with: ams apply/);
  await assert.rejects(readFile(join(f.dir, 'compose.yaml')), { code: 'ENOENT' });
});

test('standalone apply reloads edited .env, keeps its exact bytes and regenerates Compose settings', async t => {
  const f = await fixture(t);
  await save(f, { provider: 'uvx-podman-compose', CLIPROXY_SERVICE_ENABLED: true });
  const env = decodeEnv(await readFile(join(f.dir, '.env'), 'utf8'));
  env.CLIPROXY_SERVICE_PORT = '28317';
  const source = '# User comment preserved\n' + encodeEnv(env);
  await writeFile(join(f.dir, '.env'), source);
  let applied = 0;
  await applyServer(ui(), f.dir, {
    prepareImages: async options => { assert.equal(options.runtime, 'podman'); return images; },
    runtime: (directory, provider) => {
      assert.equal(directory, f.dir); assert.equal(provider, 'uvx-podman-compose');
      return runtime(f.dir, {
        preflight: async (_images, settings) => assert.equal(settings.CLIPROXY_SERVICE_PORT, '28317'),
        apply: async (key, { createAdminKey }) => { applied++; assert.equal(key, undefined); assert.equal(typeof createAdminKey, 'function'); },
      });
    },
  });
  assert.equal(applied, 1);
  assert.equal(await readFile(join(f.dir, '.env'), 'utf8'), source);
  assert.match(await readFile(join(f.dir, '.ams/compose.env'), 'utf8'), /CLIPROXY_SERVICE_PORT='28317'/);
  assert.match(await readFile(join(f.dir, 'compose.yaml'), 'utf8'), /127\.0\.0\.1:28317:8317/);
});

test('apply compares the selected provider instead of accepting another saved account', async t => {
  const f = await fixture(t);
  await save(f);
  for (const provider of ['codex', 'claude']) {
    const settings = await readEnv(join(f.dir, '.env'));
    settings.CLIPROXY_AUTH_PROVIDER = provider;
    await writeFile(join(f.dir, '.env'), encodeEnv(settings));
    const questions = ui();
    const authorized = new Set(['codex']);
    const logins = [];
    await applyServer(questions, f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
      hasProviderAuthorization: async selected => { assert.equal(selected, provider); return authorized.has(selected); },
      login: async selected => { logins.push(selected); authorized.add(selected); },
    }) });
    assert.deepEqual(questions.asked, []);
    assert.deepEqual(logins, provider === 'claude' ? ['claude'] : []);
  }
});

test('provider login cannot silently succeed without saving the selected authorization', async t => {
  const f = await fixture(t); await save(f);
  await assert.rejects(applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    hasProviderAuthorization: async () => false, login: async () => {},
  }) }), /login did not save authorization/);
});

test('standalone apply logs into the configured provider without questions and preserves settings and rollback baseline', async t => {
  const f = await fixture(t); await save(f, { CLIPROXY_AUTH_PROVIDER: 'claude' });
  await writeFile(join(f.dir, '.env'), await readFile(join(f.dir, '.env'), 'utf8') + '# Keep this operator note\n');
  const source = await readFile(join(f.dir, '.env'), 'utf8');
  const questions = ui();
  const checked = [], loggedIn = []; const authorized = new Set();
  await applyServer(questions, f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    hasProviderAuthorization: async selected => { checked.push(selected); return authorized.has(selected); },
    login: async selected => { loggedIn.push(selected); authorized.add(selected); },
  }) });
  assert.deepEqual(loggedIn, ['claude']);
  assert.deepEqual(checked, ['claude', 'claude']);
  assert.deepEqual(questions.asked, []);
  assert.equal((await readEnv(join(f.dir, '.env'))).CLIPROXY_AUTH_PROVIDER, 'claude');
  assert.equal(await readFile(join(f.dir, '.env'), 'utf8'), source);
  assert.match(questions.notes.join('\n'), /copy the full callback URL/);
  assert.match(questions.notes.at(-1), /Run ams and choose Show connection details/);
  const appliedEnv = await readFile(join(f.dir, '.env'), 'utf8');
  assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/last-applied-inputs.json'), 'utf8'))['.env'], appliedEnv);
  await writeFile(join(f.dir, '.env'), encodeEnv({ ...await readEnv(join(f.dir, '.env')), CLIPROXY_AUTH_PROVIDER: 'codex' }));
  await assert.rejects(applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    apply: async () => { throw new Error('Startup failed'); },
  }) }), /Startup failed/);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.env'), 'utf8'), appliedEnv);
});

test('an already authorized configured provider skips login and provider questions', async t => {
  const f = await fixture(t); await save(f, { CLIPROXY_AUTH_PROVIDER: 'claude' });
  const questions = ui();
  await applyServer(questions, f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    hasProviderAuthorization: async selected => selected === 'claude',
    login: async () => assert.fail('Existing Claude authorization must be reused'),
  }) });
  assert.equal((await readEnv(join(f.dir, '.env'))).CLIPROXY_AUTH_PROVIDER, 'claude');
  assert.deepEqual(questions.asked, []);
  assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/last-applied-inputs.json'), 'utf8'))['.env'], await readFile(join(f.dir, '.env'), 'utf8'));
  assert.match(questions.notes.at(-1), /Run ams and choose Show connection details/);
});

test('failed configured-provider login keeps the provider and applied settings for a retry', async t => {
  const f = await fixture(t); await save(f, { CLIPROXY_AUTH_PROVIDER: 'claude' });
  const source = await readFile(join(f.dir, '.env'), 'utf8');
  await assert.rejects(applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    hasProviderAuthorization: async () => false, login: async provider => { assert.equal(provider, 'claude'); throw new Error('Login cancelled'); },
  }) }), /Login cancelled/);
  assert.equal(await readFile(join(f.dir, '.env'), 'utf8'), source);
  assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/last-applied-inputs.json'), 'utf8'))['.env'], source);
});

test('cancelling administrator handoff after Core starts retains configuration and prevents initialization', async t => {
  const f = await fixture(t);
  await save(f, {});
  const questions = ui({ apply: true, cancelHandoff: true });
  const events = [];
  await assert.rejects(setupServer(questions, {
    directory: f.dir, listModels: async () => [],
    prepareImages: async () => { events.push('images'); return images; },
    runtime: () => runtime(f.dir, {
      apply: async (_key, { createAdminKey }) => {
        events.push('Core ready without administrator');
        await createAdminKey();
        assert.fail('Cancelled handoff must not initialize Core');
      },
    }),
  }), Cancelled);
  assert.deepEqual(events, ['images', 'Core ready without administrator']);
  assert.deepEqual(resolveDeployment(await readEnv(join(f.dir, '.env'))).services, serviceNames);
  assert.ok(!questions.asked.includes('directory'));
  assert.equal(questions.handoffs.length, 1);
  for (const file of ['.env', '.ams/runtime.json', '.ams/before-save.json']) {
    assert.ok(!(await readFile(join(f.dir, file), 'utf8')).includes(questions.handoffs[0]));
  }
});

test('Core with an active administrator applies without prompts, handoff or initialization', async t => {
  const f = await fixture(t);
  await save(f, {});
  await writeFile(join(f.dir, '.ams/applied.json'), JSON.stringify({ version: 1, services: resolveDeployment(defaults).containers }));
  const secret = 'existing-admin-secret';
  const questions = ui({ admin: secret });
  await applyServer(questions, f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    apply: async (key, { createAdminKey }) => {
      assert.equal(key, undefined);
      assert.equal(typeof createAdminKey, 'function');
      // An active administrator means the runtime never calls createAdminKey.
    },
  }) });
  assert.ok(!questions.asked.includes('admin'));
  assert.ok(!questions.asked.includes('generate:admin'));
  assert.deepEqual(questions.handoffs, []);
  for (const file of ['.env', 'compose.yaml', '.ams/runtime.json', '.ams/images.json', '.ams/compose.env', '.ams/last-applied-inputs.json']) {
    assert.ok(!(await readFile(join(f.dir, file), 'utf8')).includes(secret));
  }
});

test('Core without an administrator receives an automatically generated key after startup', async t => {
  const f = await fixture(t);
  await save(f, {});
  await mkdir(join(f.dir, 'data/core'), { recursive: true });
  const questions = ui();
  await applyServer(questions, f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    apply: async (key, { createAdminKey }) => {
      assert.equal(key, undefined);
      assert.deepEqual(questions.handoffs, []);
      assert.match(await createAdminKey(), /^sk-ams-admin-[a-f0-9]{64}$/);
    },
  }) });
  assert.ok(!questions.asked.includes('generate:admin'));
  assert.ok(!questions.asked.includes('admin'));
  assert.equal(questions.handoffs.length, 1);
});

test('a startup port retry reuses the generated administrator key and its acknowledged handoff', async t => {
  const f = await fixture(t);
  await save(f, {});
  const questions = ui(), keys = [];
  await applyServer(questions, f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    reservePorts: async () => ({ ports: {}, release: async () => {} }),
    apply: async (_key, { createAdminKey }) => {
      keys.push(await createAdminKey());
      if (keys.length === 1) throw new PortBindingConflict('busy');
    },
  }) });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(questions.handoffs, [keys[0]]);
});

async function assertAppliedOrigins(directory, expected, persisted = expected) {
  const documents = await readNativeDocuments(directory);
  const staged = JSON.parse(await readFile(join(directory, '.ams/native-runtime.json'), 'utf8'));
  for (const [name, value, origins] of [['composed', documents, persisted], ['runtime generation', staged.documents, expected]]) {
    assert.equal(parseYaml(value['proxy.yaml']).injection.externalGatewayUrl, origins.proxy, `${name}: Proxy origin`);
    assert.equal(decodeEnv(value['knowledge.env']).KNOWLEDGE_PUBLIC_BASE_URL, origins.knowledgeBase, `${name}: Knowledge origin`);
    assert.equal(JSON.parse(value['panel-instances.json']).instances[0].proxy_endpoint,
      Object.hasOwn(origins, 'registry') ? origins.registry : origins.proxy, `${name}: Panel registry origin`);
  }
  assert.equal(staged.env.MEMORY_PROXY_PUBLIC_URL, expected.proxy);
  assert.equal(staged.env.KNOWLEDGE_PUBLIC_URL, expected.knowledgeOrigin);
  assert.match(staged.generation, /^[a-f0-9-]{36}$/);
  return staged.generation;
}

async function assertFinalizedOriginSnapshot(directory) {
  const native = JSON.parse(await captureNativeConfiguration(directory));
  assert.equal(Object.hasOwn(native, 'state'), false);
  assert.equal(Object.hasOwn(native, 'originsFinalized'), false);
  const reference = JSON.parse(await readFile(join(directory, '.ams/native-config.json'), 'utf8'));
  assert.equal(reference.originsFinalized, true);
  const applied = JSON.parse(await readFile(join(directory, '.ams/last-applied-inputs.json'), 'utf8'));
  assert.deepEqual(JSON.parse(applied['.ams/native-backup.json']), native,
    'the applied rollback baseline includes the finalized native origins');
  assert.deepEqual(JSON.parse(applied['.ams/native-config.json']), reference,
    'the applied rollback baseline includes finalized runtime metadata');
}

test('first activation bind retry regenerates deferred native origins before finalizing them', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, '.env'), encodeEnv({ KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' }));
  await save(f);
  assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/native-config.json'), 'utf8')).originsFinalized, false);
  const generations = [];
  let allocations = 0;
  await applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    reservePorts: async () => {
      const offset = allocations++;
      return { ports: { MEMORY_PROXY_PORT: String(19096 + offset), KNOWLEDGE_PORT: String(18422 + offset) }, release: async () => {} };
    },
    apply: async () => {
      const offset = generations.length;
      generations.push(await assertAppliedOrigins(f.dir, {
        proxy: `http://127.0.0.1:${19096 + offset}`, knowledgeBase: `http://127.0.0.1:${18422 + offset}/v3`, knowledgeOrigin: `http://127.0.0.1:${18422 + offset}`,
      }, { proxy: '', knowledgeBase: '', registry: undefined }));
      assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/native-config.json'), 'utf8')).originsFinalized, false,
        'origins are provisional until runtime activation succeeds');
      if (generations.length === 1) throw new PortBindingConflict('first allocated port was claimed');
      await rm(join(f.dir, '.ams/apply-pending'), { force: true });
    },
  }) });
  assert.equal(generations.length, 2);
  assert.notEqual(generations[0], generations[1]);
  await assertFinalizedOriginSnapshot(f.dir);
  await assertAppliedOrigins(f.dir, { proxy: 'http://127.0.0.1:19097', knowledgeBase: 'http://127.0.0.1:18423/v3', knowledgeOrigin: 'http://127.0.0.1:18423' });
});

test('first activation retries preserve explicit operator origins and an independent Panel registry endpoint', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, '.env'), encodeEnv({ KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' }));
  await save(f);
  const native = JSON.parse(await captureNativeConfiguration(f.dir));
  const expected = { proxy: 'https://proxy.operator.invalid', knowledgeBase: 'https://knowledge.operator.invalid/v3', knowledgeOrigin: 'https://knowledge.operator.invalid', registry: 'https://panel-route.operator.invalid' };
  const proxy = parseYaml(native.overrides['proxy.yaml']);
  proxy.injection.externalGatewayUrl = expected.proxy;
  const knowledge = decodeEnv(native.overrides['knowledge.env']);
  knowledge.KNOWLEDGE_PUBLIC_BASE_URL = expected.knowledgeBase;
  const registry = JSON.parse(native.overrides['panel-instances.json']);
  registry.instances[0].proxy_endpoint = expected.registry;
  await writeFile(join(native.root, 'overrides/proxy.yaml'), stringifyYaml(proxy));
  await writeFile(join(native.root, 'overrides/knowledge.env'), encodeEnv(knowledge));
  await writeFile(join(native.root, 'overrides/panel-instances.json'), JSON.stringify(registry) + '\n');
  const originalOverrides = await Promise.all(['proxy.yaml', 'knowledge.env', 'panel-instances.json'].map(async name =>
    [name, await readFile(join(native.root, 'overrides', name), 'utf8')]));
  let attempts = 0;
  await applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    reservePorts: async () => ({ ports: { MEMORY_PROXY_PORT: String(19096 + attempts), KNOWLEDGE_PORT: String(18422 + attempts) }, release: async () => {} }),
    apply: async () => {
      await assertAppliedOrigins(f.dir, expected);
      if (++attempts === 1) throw new PortBindingConflict('first allocated port was claimed');
      await rm(join(f.dir, '.ams/apply-pending'), { force: true });
    },
  }) });
  assert.equal(attempts, 2);
  await assertAppliedOrigins(f.dir, expected);
  await assertFinalizedOriginSnapshot(f.dir);
  for (const [name, bytes] of originalOverrides) assert.equal(await readFile(join(native.root, 'overrides', name), 'utf8'), bytes, name);
});

test('a new Apply after failed first activation recomputes provisional origins for newly allocated ports', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, '.env'), encodeEnv({ KNOWLEDGE_TOOLS_PUBLIC_ENABLED: 'true' }));
  await save(f);
  let failedGeneration;
  await assert.rejects(applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    reservePorts: async () => ({ ports: { MEMORY_PROXY_PORT: '19096', KNOWLEDGE_PORT: '18422' }, release: async () => {} }),
    apply: async () => {
      failedGeneration = await assertAppliedOrigins(f.dir, { proxy: 'http://127.0.0.1:19096', knowledgeBase: 'http://127.0.0.1:18422/v3', knowledgeOrigin: 'http://127.0.0.1:18422' }, { proxy: '', knowledgeBase: '', registry: undefined });
      throw new Error('First activation readiness failed');
    },
  }) }), /First activation readiness failed/);
  assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/native-config.json'), 'utf8')).originsFinalized, false);
  let appliedGeneration;
  await applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    reservePorts: async () => ({ ports: { MEMORY_PROXY_PORT: '19097', KNOWLEDGE_PORT: '18423' }, release: async () => {} }),
    apply: async () => {
      appliedGeneration = await assertAppliedOrigins(f.dir, { proxy: 'http://127.0.0.1:19097', knowledgeBase: 'http://127.0.0.1:18423/v3', knowledgeOrigin: 'http://127.0.0.1:18423' }, { proxy: '', knowledgeBase: '', registry: undefined });
      assert.equal(JSON.parse(await readFile(join(f.dir, '.ams/native-config.json'), 'utf8')).originsFinalized, false);
      await rm(join(f.dir, '.ams/apply-pending'), { force: true });
    },
  }) });
  assert.notEqual(appliedGeneration, failedGeneration);
  await assertFinalizedOriginSnapshot(f.dir);
  await assertAppliedOrigins(f.dir, { proxy: 'http://127.0.0.1:19097', knowledgeBase: 'http://127.0.0.1:18423/v3', knowledgeOrigin: 'http://127.0.0.1:18423' });
});

test('failed image preparation retains newly saved desired configuration and existing generated files', async t => {
  const f = await fixture(t);
  await save(f, { CLIPROXY_SERVICE_PORT: '28317', CLIPROXY_SERVICE_ENABLED: true });
  await writeFile(join(f.dir, 'compose.yaml'), 'old compose bytes');
  const edited = await readEnv(join(f.dir, '.env'));
  edited.CLIPROXY_SERVICE_PORT = '28318';
  await writeFile(join(f.dir, '.env'), encodeEnv(edited));
  const questions = ui();
  await assert.rejects(setupServer(questions, {
    directory: f.dir,
    prepareImages: async () => { throw new Error('Image preparation failed'); },
    runtime: () => runtime(f.dir, { preflight: forbidden, apply: forbidden }),
  }), /Image preparation failed/);
  assert.equal((await readEnv(join(f.dir, '.env'))).CLIPROXY_SERVICE_PORT, '28318');
  assert.equal(await readFile(join(f.dir, 'compose.yaml'), 'utf8'), 'old compose bytes');
});

test('multiple saves and repeated applies preserve the last applied exact input bytes for rollback', async t => {
  const f = await fixture(t);
  await mkdir(join(f.dir, '.ams'), { recursive: true });
  const oldEnv = '# Original comments\n' + encodeEnv(resolveSettings({ ...defaults, CORE_API_KEY: 'core-key', CLIPROXY_API_KEY: 'old-service-key', INTERNAL_LLM_SOURCE: 'external' }));
  const oldProvider = '{ "provider": "podman" }\n';
  await writeFile(join(f.dir, '.env'), oldEnv);
  await writeFile(join(f.dir, '.ams/runtime.json'), oldProvider);
  await writeFile(join(f.dir, 'compose.yaml'), 'old-compose');
  await mkdir(join(f.dir, 'generated'));
  await writeFile(join(f.dir, 'generated/cli-proxy-api.yaml'), 'old-generated');
  await save(f, { provider: 'docker', LOG_LEVEL: 'warn' });
  await save(f, { LOG_LEVEL: 'info' });
  const firstInputs = await readFile(join(f.dir, '.env'), 'utf8');
  const options = { prepareImages: async () => images, runtime: () => runtime(f.dir) };
  await applyServer(ui(), f.dir, options);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.env'), 'utf8'), oldEnv);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.ams/runtime.json'), 'utf8'), oldProvider);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/generated/cli-proxy-api.yaml'), 'utf8'), 'old-generated');
  await writeFile(join(f.dir, '.env'), firstInputs + '# Later direct edit\n');
  await applyServer(ui(), f.dir, options);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.env'), 'utf8'), firstInputs);
  assert.equal(await readFile(join(f.dir, '.env'), 'utf8'), firstInputs + '# Later direct edit\n');
});

test('failed apply retains its original rollback snapshot across save and retry', async t => {
  const f = await fixture(t);
  await save(f);
  const options = { prepareImages: async () => images, runtime: () => runtime(f.dir) };
  await applyServer(ui(), f.dir, options);
  const first = await readFile(join(f.dir, '.env'), 'utf8');
  await save(f, { CLIPROXY_SERVICE_PORT: '28317' });
  await assert.rejects(applyServer(ui(), f.dir, { ...options, runtime: () => runtime(f.dir, { apply: async () => { throw new Error('Readiness failure'); } }) }), /Readiness failure/);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.env'), 'utf8'), first);
  await save(f, { CLIPROXY_SERVICE_PORT: '28318' });
  await applyServer(ui(), f.dir, options);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.env'), 'utf8'), first);
  assert.equal((await readEnv(join(f.dir, '.env'))).CLIPROXY_SERVICE_PORT, '28318');
});

test('malformed configuration files report a safe actionable error before runtime effects', async t => {
  const f = await fixture(t);
  const { DeploymentError } = await import('../dist/runtime/errors.js');
  const options = { prepareImages: forbidden, runtime: forbidden };
  await assert.rejects(applyServer(ui(), f.dir, options), error => error instanceof DeploymentError && /run ams/i.test(error.message));
  await writeFile(join(f.dir, '.env'), 'LLM_API_KEY="secret-in-invalid-json');
  await assert.rejects(applyServer(ui(), f.dir, options), error => error instanceof DeploymentError && !error.message.includes('secret-in-invalid-json'));
  await rm(join(f.dir, '.env'));
  await save(f);
  await writeFile(join(f.dir, '.ams/runtime.json'), '{"provider":"secret-in-invalid-provider');
  await assert.rejects(applyServer(ui(), f.dir, options), error => error instanceof DeploymentError && /runtime\.json/.test(error.message) && !error.message.includes('secret-in-invalid-provider'));
});

test('startup bind race resolves and persists new ports before rendering while retaining one rollback baseline', async t => {
  const f = await fixture(t);
  await save(f);
  await applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir) });
  const original = await readFile(join(f.dir, '.env'), 'utf8');
  let attempts = 0, snapshots = 0, allocations = 0, held = false;
  await applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir, {
    snapshot: async () => { snapshots++; await snapshotSettings(f.dir); },
    reservePorts: async (_manifest, env) => {
      allocations++;
      assert.equal(env.CLIPROXY_SERVICE_PORT, allocations === 1 ? '8317' : '49100');
      held = true;
      return { ports: { CLIPROXY_SERVICE_PORT: allocations === 1 ? '49100' : '49101' }, async release() { held = false; } };
    },
    apply: async () => {
      attempts++;
      assert.equal(held, false);
      const port = attempts === 1 ? '49100' : '49101';
      assert.equal((await readEnv(join(f.dir, '.env'))).CLIPROXY_SERVICE_PORT, port);
      assert.match(await readFile(join(f.dir, 'compose.yaml'), 'utf8'), new RegExp(`127\\.0\\.0\\.1:${port}:8317`));
      assert.match(await readFile(join(f.dir, '.ams/compose.env'), 'utf8'), new RegExp(`CLIPROXY_SERVICE_PORT='${port}'`));
      if (attempts === 1) throw new PortBindingConflict('busy');
      await rm(join(f.dir, '.ams/apply-pending'), { force: true });
    },
  }) });
  assert.equal(snapshots, 1);
  assert.equal(attempts, 2);
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.env'), 'utf8'), original);
  const applied = JSON.parse(await readFile(join(f.dir, '.ams/last-applied-inputs.json'), 'utf8'));
  assert.equal(applied['.env'], await readFile(join(f.dir, '.env'), 'utf8'));
});

test('startup conflict retries stop at three and unrelated runtime failures never retry', async t => {
  const f = await fixture(t);
  await save(f);
  for (const conflict of [true, false]) {
    let attempts = 0, held = false;
    await assert.rejects(applyServer(ui(), f.dir, {
      prepareImages: async () => images,
      runtime: () => runtime(f.dir, {
        reservePorts: async () => { held = true; return { ports: { CLIPROXY_SERVICE_PORT: '49100' }, async release() { held = false; } }; },
        apply: async () => { attempts++; throw conflict ? new PortBindingConflict('busy') : new Error('permission denied'); },
      }),
    }), conflict ? /after 3 attempts/ : /permission denied/);
    assert.equal(attempts, conflict ? 3 : 1);
    assert.equal(held, false);
  }
});


test('editing the active source during image preparation preserves the desired edit and rejects activation', async t => {
  const f = await fixture(t);
  await save(f, {});
  const nativeBefore = await captureNativeConfiguration(f.dir);
  const sourcePath = join(f.dir, '.ams/tdai-source.json');
  const imagePath = join(f.dir, '.ams/images.json');
  const originalImages = JSON.stringify(images) + '\n';
  await writeFile(imagePath, originalImages);
  await assert.rejects(readFile(join(f.dir, '.ams/pending-tdai-source.json')), { code: 'ENOENT' });
  const revision = 'b'.repeat(40);
  const editedSource = JSON.stringify({ revision, sha256: 'b'.repeat(64), url: `https://codeload.github.com/TencentCloud/TencentDB-Agent-Memory/tar.gz/${revision}` }) + '\n';
  const events = [];
  await assert.rejects(applyServer(ui(), f.dir, {
    prepareImages: async () => {
      events.push('images');
      await writeFile(sourcePath, editedSource);
      return images;
    },
    runtime: () => runtime(f.dir, {
      preflight: async () => { events.push('preflight'); },
      snapshot: async () => { events.push('snapshot'); },
      apply: async () => { events.push('startup'); },
    }),
  }), /Saved configuration or target revision changed during preparation/);
  assert.deepEqual(events, ['images']);
  assert.equal(await readFile(sourcePath, 'utf8'), editedSource);
  assert.equal(await readFile(imagePath, 'utf8'), originalImages);
  assert.equal(await captureNativeConfiguration(f.dir), nativeBefore);
  await assert.rejects(readFile(join(f.dir, 'compose.yaml')), { code: 'ENOENT' });
});
