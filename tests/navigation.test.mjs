import test from 'node:test';
import assert from 'node:assert/strict';
import { navigate } from '../dist/setup/navigation.js';
import { Back, Cancelled, remember } from '../dist/setup/interaction.js';

function scripted(steps) {
  const calls = [];
  const answer = (kind, id, details = {}) => {
    calls.push({ kind, id, ...details });
    const next = steps.shift();
    assert.ok(next, `Unexpected ${kind} question ${id}`);
    assert.equal(kind, next.kind);
    assert.equal(id, next.id);
    next.check?.(details);
    if (next.value instanceof Error) throw next.value;
    return next.value;
  };
  const ui = {
    async text(q) { return answer('text', q.id, q); },
    async select(id, message, options, initial) { return answer('select', id, { message, options, initial }); },
    async multiselect(id, message, options, initial) { return answer('multiselect', id, { message, options, initial }); },
    async confirm(id, message, initial) { return answer('confirm', id, { message, initial }); },
    async handoff(key) { answer('handoff', 'admin-key', { key }); },
    note() {},
    commit() { calls.push({ kind: 'commit' }); },
  };
  return { ui, calls, done() { assert.equal(steps.length, 0); } };
}

const text = (id, value, check) => ({ kind: 'text', id, value, check });
const confirm = (id, value) => ({ kind: 'confirm', id, value });
const choices = [{ value: 'core', label: 'Core' }, { value: 'proxy', label: 'Proxy' }];

test('Escape returns one question and restores answers when walking back and forward', async () => {
  const script = scripted([
    text('name', 'Alice'), text('url', 'http://saved.invalid'), confirm('start', new Back()),
    text('url', new Back(), q => assert.equal(q.initial, 'http://saved.invalid')),
    text('name', 'Alice', q => assert.equal(q.initial, 'Alice')),
    text('url', 'http://saved.invalid', q => assert.equal(q.initial, 'http://saved.invalid')),
    confirm('start', true),
  ]);
  const result = await navigate(script.ui, async ui => ({
    name: await ui.text({ id: 'name', message: 'Name' }),
    url: await ui.text({ id: 'url', message: 'URL' }),
    start: await ui.confirm('start', 'Start?'),
  }));
  assert.deepEqual(result, { name: 'Alice', url: 'http://saved.invalid', start: true });
  script.done();
});

test('changing an earlier selection discards downstream answers and selects the new branch', async () => {
  const script = scripted([
    { kind: 'select', id: 'service', value: 'core' }, text('core-name', 'old-core'), confirm('start', new Back()),
    text('core-name', new Back()), { kind: 'select', id: 'service', value: 'proxy', check: q => assert.equal(q.initial, 'core') },
    text('proxy-name', 'new-proxy', q => assert.equal(q.initial, undefined)), confirm('start', true),
  ]);
  const result = await navigate(script.ui, async ui => {
    const service = await ui.select('service', 'Service', choices);
    const name = await ui.text({ id: `${service}-name`, message: 'Name' });
    await ui.confirm('start', 'Start?');
    return { service, name };
  });
  assert.deepEqual(result, { service: 'proxy', name: 'new-proxy' });
  script.done();
});

test('generated values survive Escape at key handoff and change only with dependencies', async () => {
  let generated = 0;
  const keys = [];
  const script = scripted([
    text('name', 'Alice'), { kind: 'handoff', id: 'admin-key', value: new Back(), check: q => keys.push(q.key) },
    text('name', 'Alice'), { kind: 'handoff', id: 'admin-key', value: new Back(), check: q => keys.push(q.key) },
    text('name', 'Bob'), { kind: 'handoff', id: 'admin-key', check: q => keys.push(q.key) }, confirm('start', true),
  ]);
  const key = await navigate(script.ui, async ui => {
    const name = await ui.text({ id: 'name', message: 'Name' });
    const key = remember(ui, 'key', () => `synthetic-${++generated}`, [name]);
    await ui.handoff(key);
    await ui.confirm('start', 'Start?');
    return key;
  });
  assert.deepEqual(keys, ['synthetic-1', 'synthetic-1', 'synthetic-2']);
  assert.equal(key, 'synthetic-2');
  assert.equal(generated, 2);
  script.done();
});

test('returning to a secret offers keeping it without exposing it as initial text', async () => {
  const script = scripted([
    text('key', 'synthetic-secret'), confirm('start', new Back()),
    text('key', '', q => {
      assert.equal(q.initial, undefined);
      assert.equal(q.secret, true);
      assert.match(q.message, /Enter to keep the previous value/);
      assert.equal(JSON.stringify(q).includes('synthetic-secret'), false);
      assert.equal(q.validate(''), undefined);
      assert.equal(q.validate('bad'), 'Invalid key');
    }), confirm('start', true),
  ]);
  const key = await navigate(script.ui, async ui => {
    const value = await ui.text({ id: 'key', message: 'API key', secret: true, validate: value => value.startsWith('synthetic-') ? undefined : 'Invalid key' });
    await ui.confirm('start', 'Start?');
    return value;
  });
  assert.equal(key, 'synthetic-secret');
  script.done();
});

test('Ctrl+C exits immediately and Escape on the first question also cancels', async () => {
  for (const cancellation of [new Back(), new Cancelled()]) {
    const script = scripted([text('name', cancellation)]);
    let runs = 0;
    await assert.rejects(navigate(script.ui, async ui => {
      runs++;
      remember(ui, 'before-first-question', () => 'memo');
      await ui.text({ id: 'name', message: 'Name' });
    }), Cancelled);
    assert.equal(runs, 1);
    script.done();
  }
});

test('commit prevents Escape from replaying completed installation effects', async () => {
  const script = scripted([text('name', 'Alice'), confirm('next', new Back())]);
  let effects = 0;
  await assert.rejects(navigate(script.ui, async ui => {
    await ui.text({ id: 'name', message: 'Name' });
    ui.commit();
    effects++;
    await ui.confirm('next', 'Continue?');
  }), Cancelled);
  assert.equal(effects, 1);
  assert.equal(script.calls.filter(call => call.kind === 'commit').length, 1);
  script.done();
});

test('changed option lists invalidate previously selected and multiselected values', async () => {
  for (const kind of ['select', 'multiselect']) {
    let options = choices;
    const script = scripted([
      { kind, id: 'service', value: kind === 'select' ? 'core' : ['core'] },
      { ...confirm('next', new Back()), check: () => { options = [choices[1]]; } },
      { kind, id: 'service', value: kind === 'select' ? 'proxy' : ['proxy'], check: q => {
        assert.deepEqual(q.options, [choices[1]]);
        assert.deepEqual(q.initial, kind === 'select' ? undefined : []);
      } }, confirm('next', true),
    ]);
    const selected = await navigate(script.ui, async ui => {
      const value = kind === 'select'
        ? await ui.select('service', 'Service', options)
        : await ui.multiselect('service', 'Service', options, []);
      await ui.confirm('next', 'Continue?');
      return value;
    });
    assert.deepEqual(selected, kind === 'select' ? 'proxy' : ['proxy']);
    script.done();
  }
});
