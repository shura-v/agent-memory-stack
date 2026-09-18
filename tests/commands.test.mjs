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
  assert.deepEqual(parseCommand(['update', 'tdai']), { action: 'update-tdai' });
  for (const args of [['apply', 'server'], ['apply', 'client'], ['apply', './server'], ['apply', 'server', '/tmp'], ['unknown'], ['--help', 'unknown'], ['update'], ['update', 'other'], ['update', 'tdai', '/tmp']]) {
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

test('TDAI update uses the saved installation and applies it after resolving the revision', async () => {
  const calls = [], notes = [];
  const forbidden = () => assert.fail('update must not configure or inspect a new installation');
  const targets = { recall: async target => {
    assert.equal(target, 'server');
    return '/tmp/saved-stack';
  }, remember: forbidden };
  await executeCommand(parseCommand(['update', 'tdai']), { note: (...args) => notes.push(args) }, {
    targets,
    detectInstallation: forbidden,
    updateTdai: async path => {
      calls.push(['update', path]);
      return { previousRevision: 'previous-revision', revision: 'new-revision' };
    },
    workflows: { setupServer: forbidden, applyServer: async (_ui, path, options) => {
      assert.equal(options.targets, targets);
      calls.push(['apply', path]);
    } },
  });
  assert.deepEqual(calls, [['update', '/tmp/saved-stack'], ['apply', '/tmp/saved-stack']]);
  assert.match(notes.find(([, title]) => title === 'TDAI revision')[0], /previous-revision → new-revision/);
});

test('TDAI update requires a saved installation before downloading or applying', async () => {
  const forbidden = () => assert.fail('missing target must stop before update or apply');
  await assert.rejects(executeCommand(parseCommand(['update', 'tdai']), { note: forbidden }, {
    targets: { recall: async () => undefined, remember: forbidden },
    updateTdai: forbidden,
    detectInstallation: forbidden,
    workflows: { setupServer: forbidden, applyServer: forbidden },
  }), /No saved configuration/);
});

test('failed TDAI update does not apply the installation', async () => {
  const forbidden = () => assert.fail('failed update must not apply');
  const failure = new Error('source unavailable');
  await assert.rejects(executeCommand(parseCommand(['update', 'tdai']), { note() {} }, {
    targets: { recall: async () => '/tmp/saved-stack', remember: forbidden },
    updateTdai: async () => { throw failure; },
    detectInstallation: forbidden,
    workflows: { setupServer: forbidden, applyServer: forbidden },
  }), error => error === failure);
});

test('Configure stack forwards its target store', async () => {
  const targets = { recall: async () => undefined, remember: async () => {} };
  const calls = [];
  await executeCommand(parseCommand([]), { note() {}, select: async (_id, _message, options, initial) => {
    assert.deepEqual(options.map(option => option.label), ['Configure stack', 'Apply configuration', 'Show connection details']);
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
  assert.match(output, /ams update tdai\s+Update TDAI and apply saved configuration/);
  assert.doesNotMatch(output, /apply server/);
  assert.doesNotMatch(output, /client/i);
  assert.doesNotMatch(output, /prepared server images/);
  assert.throws(() => execFileSync(process.execPath, [cli.pathname, 'apply', './server'], { stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /Usage: ams/);
    return error.status === 1;
  });
});

test('Show connection details uses the remembered installation without configuring or applying', async () => {
  const forbidden = () => assert.fail('Connection details must not configure, apply, or inspect the setup guard');
  let shown;
  await executeCommand(parseCommand([]), { note() {}, select: async () => 'connections' }, {
    targets: { recall: async () => '/tmp/saved-stack', remember: forbidden },
    workflows: { setupServer: forbidden, applyServer: forbidden }, detectInstallation: forbidden,
    showConnectionDetails: async (_ui, directory) => { shown = directory; },
  });
  assert.equal(shown, '/tmp/saved-stack');
});

test('TDAI update requires an interactive terminal before reading configuration or downloading', () => {
  const cli = new URL('../dist/cli.js', import.meta.url);
  assert.throws(() => execFileSync(process.execPath, [cli.pathname, 'update', 'tdai'], { stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /Run ams in an interactive terminal/);
    return error.status === 1;
  });
});
