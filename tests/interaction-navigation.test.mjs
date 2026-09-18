import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import * as prompts from '@clack/prompts';
import { createInteraction } from '../dist/cli/interaction.js';
import { Back, Cancelled } from '../dist/setup/interaction.js';

const choices = [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }];
const questions = [
  ['text', ui => ui.text({ id: 'name', message: 'Name' })],
  ['password', ui => ui.text({ id: 'key', message: 'Key', secret: true })],
  ['select', ui => ui.select('model', 'Model', choices, 'first')],
  ['multiselect', ui => ui.multiselect('services', 'Services', choices, ['first'])],
  ['confirm', ui => ui.confirm('start', 'Start?')],
  ['select', ui => ui.handoff('synthetic-admin-key')],
];

test('every prompt distinguishes Escape from Ctrl+C and releases its key listener', async () => {
  for (const [method, ask] of questions) {
    for (const [key, error] of [[{ name: 'escape', sequence: '\x1b' }, Back], [{ name: 'c', ctrl: true, sequence: '\x03' }, Cancelled]]) {
      const input = new EventEmitter();
      const otherListener = () => {};
      input.on('keypress', otherListener);
      const ui = createInteraction({
        isCancel: value => typeof value === 'symbol', note() {},
        async [method]() { input.emit('keypress', undefined, key); return Symbol('cancel'); },
      }, input, { write() {} });
      await assert.rejects(ask(ui), error);
      assert.deepEqual(input.listeners('keypress'), [otherListener]);
    }
  }
});

test('Escape state is local to one prompt and cleanup also runs when a prompt fails', async () => {
  const input = new EventEmitter();
  let call = 0;
  const failure = new Error('Prompt failed');
  const ui = createInteraction({
    isCancel: value => typeof value === 'symbol',
    async text() {
      call++;
      if (call === 1) input.emit('keypress', undefined, { name: 'escape' });
      if (call === 3) throw failure;
      return Symbol('cancel');
    },
  }, input);
  await assert.rejects(ui.text({ id: 'one', message: 'One' }), Back);
  await assert.rejects(ui.text({ id: 'two', message: 'Two' }), Cancelled);
  await assert.rejects(ui.text({ id: 'three', message: 'Three' }), error => error === failure);
  assert.equal(input.listenerCount('keypress'), 0);
});

function terminal() {
  const input = new PassThrough();
  let rendered = '';
  const output = new Writable({ write(chunk, _encoding, done) { rendered += chunk.toString(); done(); } });
  output.isTTY = true;
  output.columns = 80;
  const adapter = Object.fromEntries(['text', 'password', 'select', 'multiselect', 'confirm'].map(method => [
    method, options => prompts[method]({ ...options, input, output }),
  ]));
  return { input, output, ui: createInteraction({ ...prompts, ...adapter }, input, output), rendered: () => rendered };
}

test('administrator key handoff has one OK action and Enter continues', { timeout: 2000 }, async () => {
  const { input, output, ui, rendered } = terminal();
  try {
    const handoff = ui.handoff('synthetic-admin-key');
    const screen = rendered();
    assert.match(screen, /synthetic-admin-key\n\n/);
    assert.match(screen, /OK/);
    assert.doesNotMatch(screen, /Yes|No|Continue initialization\?/);
    input.write('\r');
    await handoff;
    assert.equal(input.listenerCount('keypress'), 0);
  } finally { input.destroy(); output.destroy(); }
});

test('real Clack stream keeps arrow navigation and recognizes a standalone Escape', { timeout: 2000 }, async () => {
  const { input, output, ui } = terminal();
  try {
    const selection = ui.select('model', 'Model', choices, 'first');
    input.write('\x1b[B\r');
    assert.equal(await selection, 'second');
    assert.equal(input.listenerCount('keypress'), 0);
    const back = assert.rejects(ui.select('model', 'Model', choices, 'second'), Back);
    input.write('\x1b');
    await back;
    assert.equal(input.listenerCount('keypress'), 0);
    const cancel = assert.rejects(ui.confirm('start', 'Start?'), Cancelled);
    input.write('\x03');
    await cancel;
    assert.equal(input.listenerCount('keypress'), 0);
  } finally { input.destroy(); output.destroy(); }
});

test('real Clack password masks typed secrets when Escape returns to the prior question', { timeout: 2000 }, async () => {
  const { input, output, ui, rendered } = terminal();
  try {
    const back = assert.rejects(ui.text({ id: 'key', message: 'API key', secret: true }), Back);
    input.write('synthetic-secret-value');
    input.write('\x1b');
    await back;
    assert.equal(rendered().includes('synthetic-secret-value'), false);
    assert.equal(input.listenerCount('keypress'), 0);
  } finally { input.destroy(); output.destroy(); }
});
