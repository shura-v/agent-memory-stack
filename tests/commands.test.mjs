import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { executeCommand, parseCommand } from '../dist/cli/commands.js';
import { Cancelled } from '../dist/setup/interaction.js';

async function fixture(t, saved = true) {
  const directory = await mkdtemp(join(tmpdir(), 'ams-commands-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (saved) await writeFile(join(directory, '.env'), 'DATA_DIR="./data"\n');
  return directory;
}
const forbidden = () => assert.fail('Unexpected workflow or side effect');

test('CLI accepts plain apply without target or installation path arguments', () => {
  assert.deepEqual(parseCommand([]), { action: 'setup' });
  assert.deepEqual(parseCommand(['--help']), { action: 'help' });
  assert.deepEqual(parseCommand(['apply']), { action: 'apply' });
  assert.deepEqual(parseCommand(['update', 'tdai']), { action: 'update-tdai' });
  for (const args of [['apply', 'server'], ['apply', 'client'], ['apply', './server'], ['apply', 'server', '/tmp'], ['unknown'], ['--help', 'unknown'], ['update'], ['update', 'other'], ['update', 'tdai', '/tmp']]) {
    assert.throws(() => parseCommand(args), /Usage: ams/);
  }
});

test('standalone apply uses the fixed configuration directory without reading an old targets registry', async t => {
  const directory = await fixture(t);
  const registry = join(directory, 'targets.json');
  await writeFile(registry, 'obsolete registry deliberately not valid JSON');
  const calls = [];
  await executeCommand(parseCommand(['apply']), { note() {} }, { directory,
    workflows: { setupServer: forbidden, applyServer: async (_ui, path) => calls.push(path) },
  });
  assert.deepEqual(calls, [directory]);
  assert.equal(await readFile(registry, 'utf8'), 'obsolete registry deliberately not valid JSON');
});

test('missing .env stops apply, update and connection details with setup-first guidance', async t => {
  const directory = await fixture(t, false);
  for (const action of ['apply', 'update-tdai', 'connections']) {
    await assert.rejects(executeCommand({ action: action === 'connections' ? 'setup' : action }, {
      note() {}, select: async () => 'connections',
    }, { directory, updateTdai: forbidden, showConnectionDetails: forbidden,
      detectInstallation: forbidden, workflows: { setupServer: forbidden, applyServer: forbidden },
    }), /No saved configuration.*Configure stack first/);
  }
  assert.deepEqual(await readdir(directory), []);
});

test('TDAI update uses the fixed installation and applies it after resolving the revision', async t => {
  const directory = await fixture(t);
  const calls = [], notes = [];
  await executeCommand(parseCommand(['update', 'tdai']), { note: (...args) => notes.push(args) }, {
    directory, detectInstallation: forbidden,
    updateTdai: async path => { calls.push(['update', path]); return { previousRevision: 'previous-revision', revision: 'new-revision' }; },
    workflows: { setupServer: forbidden, applyServer: async (_ui, path) => calls.push(['apply', path]) },
  });
  assert.deepEqual(calls, [['update', directory], ['apply', directory]]);
  assert.match(notes.find(([, title]) => title === 'TDAI revision')[0], /previous-revision → new-revision/);
});

test('failed TDAI update does not apply the installation', async t => {
  const directory = await fixture(t);
  const failure = new Error('source unavailable');
  await assert.rejects(executeCommand(parseCommand(['update', 'tdai']), { note() {} }, {
    directory, updateTdai: async () => { throw failure; }, detectInstallation: forbidden,
    workflows: { setupServer: forbidden, applyServer: forbidden },
  }), error => error === failure);
});

test('Configure stack forwards the fixed directory without creating a targets registry', async t => {
  const directory = await fixture(t, false);
  const calls = [];
  await executeCommand(parseCommand([]), { note() {}, select: async (_id, _message, options, initial) => {
    assert.deepEqual(options.map(option => option.label), ['Configure stack', 'Apply configuration', 'Show connection details']);
    assert.equal(initial, 'configure');
    return 'configure';
  } }, { directory, detectInstallation: async () => undefined,
    workflows: { setupServer: async (_ui, options) => calls.push(options), applyServer: forbidden },
  });
  assert.deepEqual(calls, [{ directory }]);
  assert.deepEqual(await readdir(directory), []);
});

test('existing stack guard runs after menu selection and gives truthful legacy Compose guidance', async t => {
  const directory = await fixture(t, false);
  for (const location of [directory, join(directory, 'legacy stack'), undefined]) {
    const notes = [], calls = [];
    await executeCommand(parseCommand([]), { note: (...args) => notes.push(args), select: async id => {
      assert.equal(id, 'action'); calls.push('menu'); return 'configure';
    } }, { directory, detectInstallation: async () => {
      calls.push('detect'); return { engine: 'podman', project: 'ams-1234567890', directory: location };
    }, workflows: { setupServer: forbidden, applyServer: forbidden } });
    assert.deepEqual(calls, ['menu', 'detect']);
    const message = notes.find(([, title]) => title === 'Stack already configured')[0];
    if (location === directory) assert.match(message, /Apply saved changes with: ams apply/);
    else { assert.doesNotMatch(message, /ams apply/); assert.match(message, /manually.*Compose project and configuration/); }
  }
});

test('cancelling the menu does not inspect containers or enter setup', async () => {
  await assert.rejects(executeCommand(parseCommand([]), {
    note() {}, select: async () => { throw new Cancelled(); },
  }, { detectInstallation: forbidden, workflows: { setupServer: forbidden, applyServer: forbidden } }), Cancelled);
});

test('default configuration location is fixed under home regardless of working directory or XDG_CONFIG_HOME', async t => {
  const home = await fixture(t, false);
  const directory = join(home, '.agent-memory-stack');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, '.env'), 'DATA_DIR="./data"\n');
  const commandsUrl = new URL('../dist/cli/commands.js', import.meta.url).href;
  const source = `import {executeCommand} from ${JSON.stringify(commandsUrl)}; await executeCommand({action:'apply'},{note(){}},{workflows:{setupServer(){throw Error('setup')},async applyServer(_ui,path){console.log(path)}}});`;
  for (const cwd of [home, directory]) {
    const actual = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'other') },
    }).trim();
    assert.equal(actual, directory);
  }
  assert.deepEqual(await readdir(directory), ['.env']);
});

test('menu Apply uses the fixed directory without the Configure stack guard', async t => {
  const directory = await fixture(t);
  const calls = [];
  await executeCommand(parseCommand([]), { note() {}, select: async id => { assert.equal(id, 'action'); return 'apply'; } }, {
    directory, workflows: { setupServer: forbidden, applyServer: async (_ui, path) => calls.push(path) }, detectInstallation: forbidden,
  });
  assert.deepEqual(calls, [directory]);
});

test('help documents the fixed configuration location without a TTY or configuration', () => {
  const cli = new URL('../dist/cli.js', import.meta.url);
  const output = execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.match(output, /ams apply\s+Apply saved configuration/);
  assert.match(output, /ams update tdai\s+Update TDAI and apply saved configuration/);
  assert.match(output, /~\/\.agent-memory-stack/);
  assert.doesNotMatch(output, /most recently saved|apply server|client|prepared server images/i);
  assert.throws(() => execFileSync(process.execPath, [cli.pathname, 'apply', './server'], { stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /Usage: ams/); return error.status === 1;
  });
});

test('Show connection details uses the fixed directory without configuring or applying', async t => {
  const directory = await fixture(t);
  let shown;
  await executeCommand(parseCommand([]), { note() {}, select: async () => 'connections' }, {
    directory, workflows: { setupServer: forbidden, applyServer: forbidden }, detectInstallation: forbidden,
    showConnectionDetails: async (_ui, path) => { shown = path; },
  });
  assert.equal(shown, directory);
});

test('TDAI update requires an interactive terminal before reading configuration or downloading', () => {
  const cli = new URL('../dist/cli.js', import.meta.url);
  assert.throws(() => execFileSync(process.execPath, [cli.pathname, 'update', 'tdai'], { stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /Run ams in an interactive terminal/); return error.status === 1;
  });
});
