import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupServer, applyServer } from '../dist/setup/server.js';
import { encodeEnv, readEnv } from '../dist/config/files.js';
import { validateEnv } from '../dist/config/settings.js';
import { snapshotSettings } from '../dist/runtime/snapshot.js';
import { Cancelled } from '../dist/setup/interaction.js';
import { PortBindingConflict } from '../dist/runtime/errors.js';

const images = { schemaVersion: 1, images: Object.fromEntries(['runtime', 'cli-proxy-api', 'core'].map((name, i) => [name, {
  id: 'sha256:' + String(i + 1).repeat(64), tag: `${name}:test`, platform: 'linux/arm64', repoDigests: [],
}])) };
const defaults = { LLM_BASE_URL: 'https://provider.invalid/v1', LLM_API_KEY: 'provider-secret', MEMORY_LLM_MODEL: 'memory-model' };
function ui(answers = {}) {
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
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir };
}
function forbidden() { assert.fail('Save-only must not invoke runtime or image preparation'); }
async function save(f, answers = {}, options = {}) {
  const previous = await readEnv(join(f.dir, '.env'));
  const settings = { AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_SERVICE_ENABLED: 'true', ...previous };
  if (answers.services) settings.AMS_SERVICES = answers.services.join(',');
  for (const [key, value] of Object.entries(answers)) if (/^(?:CLIPROXY_SERVICE_PORT|CLIPROXY_SERVICE_ENABLED)$/.test(key)) settings[key] = String(value);
  if (!Object.keys(previous).length || answers.services || answers.CLIPROXY_SERVICE_PORT || answers.CLIPROXY_SERVICE_ENABLED !== undefined) {
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

test('No saves a fresh Core configuration without directory, engine or admin prompts', async t => {
  const f = await fixture(t);
  const questions = await save(f, { services: ['core'], provider: 'podman-compose' });
  const env = await readEnv(join(f.dir, '.env'));
  assert.equal(env.AMS_SERVICES, 'core');
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
  const env = await readEnv(join(f.dir, '.env'));
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
        apply: async (key, { createAdminKey }) => { applied++; assert.equal(key, undefined); assert.equal(createAdminKey, undefined); },
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
  await save(f, { services: ['core'] });
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
  assert.equal((await readEnv(join(f.dir, '.env'))).AMS_SERVICES, 'core');
  assert.ok(!questions.asked.includes('directory'));
  assert.equal(questions.handoffs.length, 1);
  for (const file of ['.env', '.ams/runtime.json', '.ams/before-save.json']) {
    assert.ok(!(await readFile(join(f.dir, file), 'utf8')).includes(questions.handoffs[0]));
  }
});

test('Core with an active administrator applies without prompts, handoff or initialization', async t => {
  const f = await fixture(t);
  await save(f, { services: ['core'] });
  await writeFile(join(f.dir, '.ams/applied.json'), JSON.stringify({ version: 1, services: ['core', 'config', 'bootstrap'] }));
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
  await save(f, { services: ['core'] });
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
  await save(f, { services: ['core'] });
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
  await mkdir(join(f.dir, '.ams'));
  const oldEnv = '# Original comments\n' + encodeEnv(validateEnv({ AMS_DEPLOYMENT_VERSION: '1', AMS_SERVICES: 'cli-proxy-api', CLIPROXY_API_KEY: 'old-service-key' }));
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

test('invalid saved configuration reports a safe actionable error before runtime effects', async t => {
  const f = await fixture(t);
  const { DeploymentError } = await import('../dist/runtime/errors.js');
  const options = { prepareImages: forbidden, runtime: forbidden };
  await assert.rejects(applyServer(ui(), f.dir, options), error => error instanceof DeploymentError && /run ams/i.test(error.message));
  await writeFile(join(f.dir, '.env'), 'LLM_API_KEY="secret-in-invalid-json');
  await assert.rejects(applyServer(ui(), f.dir, options), error => error instanceof DeploymentError && !error.message.includes('secret-in-invalid-json'));
  await rm(join(f.dir, '.env'));
  await save(f);
  await writeFile(join(f.dir, '.ams/runtime.json'), '{"provider":"secret-in-invalid-provider"}');
  await assert.rejects(applyServer(ui(), f.dir, options), error => error instanceof DeploymentError && /runtime\.json/.test(error.message) && !error.message.includes('secret-in-invalid-provider'));
});

test('startup bind race resolves and persists new ports before rendering while retaining one rollback baseline', async t => {
  const f = await fixture(t);
  await save(f);
  await applyServer(ui(), f.dir, { prepareImages: async () => images, runtime: () => runtime(f.dir) });
  const original = await readFile(join(f.dir, '.env'), 'utf8');
  const originalNetwork = await readFile(join(f.dir, '.ams/network.json'), 'utf8');
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
  assert.equal(await readFile(join(f.dir, '.ams/previous-settings/.ams/network.json'), 'utf8'), originalNetwork);
  const applied = JSON.parse(await readFile(join(f.dir, '.ams/last-applied-inputs.json'), 'utf8'));
  assert.equal(applied['.env'], await readFile(join(f.dir, '.env'), 'utf8'));
  assert.equal(applied['.ams/network.json'], await readFile(join(f.dir, '.ams/network.json'), 'utf8'));
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
