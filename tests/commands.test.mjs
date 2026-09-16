import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createTargetStore } from '../dist/setup/targets.js';
import { executeCommand, parseCommand } from '../dist/cli/commands.js';
import { Cancelled } from '../dist/setup/interaction.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ams-targets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, 'targets.json') };
}

test('CLI accepts plain apply without target or installation path arguments', () => {
  assert.deepEqual(parseCommand([]), { action: 'setup' });
  assert.deepEqual(parseCommand(['--help']), { action: 'help' });
  assert.deepEqual(parseCommand(['apply']), { action: 'apply' });
  for (const args of [['apply', 'server'], ['apply', 'client'], ['apply', './server'], ['apply', 'server', '/tmp'], ['unknown'], ['--help', 'unknown']]) {
    assert.throws(() => parseCommand(args), /Usage: ams/);
  }
});

test('saved server location persists across store instances with private permissions', async t => {
  const { dir, path } = await fixture(t);
  const targets = createTargetStore(path);
  assert.equal(await targets.recall('server'), undefined);
  await targets.remember('server', join(dir, 'one'));
  const reopened = createTargetStore(path);
  await reopened.remember('server', join(dir, 'two'));
  assert.equal(await reopened.recall('server'), join(dir, 'two'));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(path, 'utf8'))).sort(), ['server', 'version']);
});

test('existing registry extras do not prevent applying or saving the server location', async t => {
  const { dir, path } = await fixture(t);
  await writeFile(path, JSON.stringify({ version: 1, server: join(dir, 'server'), client: join(dir, 'profile.json') }));
  const targets = createTargetStore(path);
  assert.equal(await targets.recall('server'), join(dir, 'server'));
  await targets.remember('server', join(dir, 'updated'));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, server: join(dir, 'updated') });
});

test('invalid target records and relative locations fail instead of guessing', async t => {
  const { path } = await fixture(t), targets = createTargetStore(path);
  await assert.rejects(targets.remember('server', './server'), /absolute path/);
  for (const source of ['broken', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, server: './server' }), JSON.stringify({ version: 1, secret: 'do-not-log' })]) {
    await writeFile(path, source);
    await assert.rejects(targets.recall('server'), error => /Cannot read saved setup locations/.test(error.message) && !error.message.includes('do-not-log'));
  }
});

test('standalone apply routes the remembered absolute path without setup questions', async t => {
  const { dir, path } = await fixture(t), targets = createTargetStore(path);
  const calls = [];
  const ui = { note() {} };
  const workflows = {
    setupServer: async () => assert.fail('must not run setup'),
    applyServer: async (_ui, path) => calls.push(['server', path]),
  };
  await assert.rejects(executeCommand(parseCommand(['apply']), ui, { targets, workflows }), /No saved configuration/);
  const location = join(dir, 'server');
  await targets.remember('server', location);
  await executeCommand(parseCommand(['apply']), ui, { targets, workflows });
  assert.deepEqual(calls, [['server', location]]);
});

test('Configure stack forwards its target store', async () => {
  const targets = { recall: async () => undefined, remember: async () => {} };
  const calls = [];
  await executeCommand(parseCommand([]), { note() {}, select: async (_id, _message, options, initial) => {
    assert.deepEqual(options.map(option => option.label), ['Configure stack', 'Apply configuration']);
    assert.equal(initial, 'configure');
    return 'configure';
  } }, {
    targets,
    detectInstallation: async () => undefined,
    workflows: {
      setupServer: async (_ui, options) => { calls.push(options.targets); },
      applyServer: async () => assert.fail('setup decides when to apply'),
    },
  });
  assert.deepEqual(calls, [targets]);
});

test('existing stack is checked after Configure stack and before target lookup or setup effects', async () => {
  const notes = [];
  const calls = [];
  const forbidden = () => assert.fail('existing stack must not enter setup or read another target');
  await executeCommand(parseCommand([]), { note: (...args) => notes.push(args), select: async id => {
    assert.equal(id, 'action');
    calls.push('menu');
    return 'configure';
  } }, {
    detectInstallation: async () => {
      calls.push('detect');
      return { engine: 'podman', project: 'ams-1234567890', directory: '/tmp/existing stack' };
    },
    targets: { recall: forbidden, remember: forbidden },
    workflows: { setupServer: forbidden, applyServer: forbidden },
  });
  assert.deepEqual(calls, ['menu', 'detect']);
  const existing = notes.find(([, title]) => title === 'Stack already configured');
  assert.match(existing[0], /Edit \/tmp\/existing stack\/\.env/);
});

test('cancelling the menu does not inspect containers or enter setup', async () => {
  const forbidden = () => assert.fail('cancelled menu must not inspect containers or enter setup');
  await assert.rejects(executeCommand(parseCommand([]), {
    note() {}, select: async () => { throw new Cancelled(); },
  }, {
    detectInstallation: forbidden,
    targets: { recall: forbidden, remember: forbidden },
    workflows: { setupServer: forbidden, applyServer: forbidden },
  }), Cancelled);
});

test('remembered target resolves from a different process working directory', async t => {
  const { dir, path } = await fixture(t);
  const location = join(dir, 'server');
  await createTargetStore(path).remember('server', location);
  const moduleUrl = new URL('../dist/setup/targets.js', import.meta.url).href;
  const source = `import {createTargetStore} from ${JSON.stringify(moduleUrl)}; console.log(await createTargetStore(process.argv[1]).recall('server'));`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', source, path], { cwd: tmpdir(), encoding: 'utf8' }).trim(), location);
});

test('menu Apply configuration uses the saved target without the Configure stack guard', async () => {
  const calls = [];
  const forbidden = () => assert.fail('Apply must not enter Configure stack');
  const targets = { recall: async target => { assert.equal(target, 'server'); return '/tmp/saved-stack'; }, remember: forbidden };
  const workflows = { setupServer: forbidden, applyServer: async (_ui, path) => calls.push(path) };
  await executeCommand(parseCommand([]), { note() {}, select: async id => { assert.equal(id, 'action'); return 'apply'; } }, {
    targets, workflows, detectInstallation: forbidden,
  });
  assert.deepEqual(calls, ['/tmp/saved-stack']);
});

test('help and invalid arguments work without a TTY or configuration', () => {
  const cli = new URL('../dist/cli.js', import.meta.url);
  const output = execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.match(output, /ams apply\s+Apply saved configuration/);
  assert.doesNotMatch(output, /apply server/);
  assert.doesNotMatch(output, /client/i);
  assert.doesNotMatch(output, /prepared server images/);
  assert.throws(() => execFileSync(process.execPath, [cli.pathname, 'apply', './server'], { stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /Usage: ams/);
    return error.status === 1;
  });
});
