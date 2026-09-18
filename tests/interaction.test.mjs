import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteraction } from '../dist/cli/interaction.js';
import { Cancelled } from '../dist/setup/interaction.js';

test('explicit copyable output writes a key as one undecorated line', () => {
  const chunks = [];
  const ui = createInteraction({ note: () => assert.fail('Copyable keys must not be boxed') }, undefined, { write: chunk => chunks.push(chunk) });
  const key = 'sk-ams-user-' + 'a'.repeat(64);
  ui.print(key);
  assert.deepEqual(chunks, [key + '\n']);
});

test('Clack adapter passes saved checkbox values and leaves empty selection to the workflow', async () => {
  const choices = [{ value: 'core', label: 'Core (memory storage)' }, { value: 'panel', label: 'Panel (web interface)' }];
  let received;
  const ui = createInteraction({ isCancel: value => typeof value === 'symbol', multiselect: async options => { received = options; return []; } });
  assert.deepEqual(await ui.multiselect('services', 'What would you like to run on this machine?', choices, ['panel']), []);
  assert.deepEqual(received.options, choices);
  assert.deepEqual(received.initialValues, ['panel']);
  assert.equal(received.required, false);
});

test('Clack multiselect cancellation becomes a workflow cancellation', async () => {
  const ui = createInteraction({ isCancel: value => typeof value === 'symbol', multiselect: async () => Symbol('cancel') });
  await assert.rejects(ui.multiselect('services', 'Services', [{ value: 'core', label: 'Core' }], ['core']), Cancelled);
});

test('text placeholders stay separate from saved values and never become defaults', async () => {
  const calls = [];
  const ui = createInteraction({ isCancel: () => false, text: async options => { calls.push(options); return options.initialValue ?? ''; } });
  const question = { id: 'endpoint', message: 'API base URL', placeholder: 'https://api.example.com/v1', validate: value => value ? undefined : 'Enter your API base URL' };
  assert.equal(await ui.text(question), '');
  assert.equal(calls[0].placeholder, question.placeholder);
  assert.equal(calls[0].initialValue, undefined);
  assert.equal(calls[0].defaultValue, undefined);
  assert.equal(calls[0].validate(undefined), 'Enter your API base URL');
  const saved = 'https://saved.provider.invalid/api/v4';
  assert.equal(await ui.text({ ...question, initial: saved }), saved);
  assert.equal(calls[1].initialValue, saved);
  assert.equal(calls[1].placeholder, question.placeholder);
});
