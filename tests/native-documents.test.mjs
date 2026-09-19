import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeDocument as parse, updateNativeDocument as update, composeNativeDocument as compose, validateNativeDeletions, nativeTemplateChanges } from '../dist/config/native-documents.js';
import { parseNativeEnv } from '../dist/runtime/native-env.js';

for (const format of ['yaml', 'json']) {
  const cases = [
    ['inherit complete defaults', { a: 1, nested: { untouched: true } }, undefined, { a: 1, nested: { untouched: true } }],
    ['nested overlay', { a: 1, map: { x: 1, y: true } }, { map: { x: 2 } }, { a: 1, map: { x: 2, y: true } }],
    ['unknown additions', { a: 1 }, { future: { enabled: true } }, { a: 1, future: { enabled: true } }],
    ['explicit values', { a: 1, b: true, c: 2, d: 'x' }, { a: null, b: false, c: 0, d: '' }, { a: null, b: false, c: 0, d: '' }],
    ['empty mappings inherit children', { map: { x: 1 } }, { map: {} }, { map: { x: 1 } }],
    ['different types override', { a: { b: 1 }, b: [] }, { a: false, b: { child: 2 } }, { a: false, b: { child: 2 } }],
    ['empty mapping replaces scalar type', { a: 1 }, { a: {} }, { a: {} }],
    ['arrays replace whole', { items: [{ a: 1 }, { b: 2 }] }, { items: [{ c: 3 }] }, { items: [{ c: 3 }] }],
    ['empty array replaces whole', { items: [1, 2] }, { items: [] }, { items: [] }],
    ['numeric mapping keys are fields', { values: { '0': 'old', '1': 'keep' } }, { values: { '0': 'new' } }, { values: { '0': 'new', '1': 'keep' } }],
  ];
  for (const [name, defaults, overrides, expected] of cases) test(`${format}: ${name}`, () => {
    const original = JSON.stringify(defaults), overlay = overrides === undefined ? undefined : JSON.stringify(overrides);
    assert.deepEqual(parse(compose(original, overlay, format), format), expected);
    assert.equal(JSON.stringify(defaults), original);
    assert.equal(overrides === undefined ? undefined : JSON.stringify(overrides), overlay);
  });

  test(`${format}: explicit deletions, escaped pointers and missing targets`, () => {
    const defaults = JSON.stringify({ map: { model: 'default', timeout: 30 }, items: [1], 'a/b': { '~key': true }, nullable: null, numeric: { '0': 1, '1': 2 } });
    const overlay = JSON.stringify({ map: { model: 'chosen' } });
    const pointers = ['/map/timeout', '/items', '/a~1b/~0key', '/missing/child', '/nullable/child', '/numeric/0'];
    assert.deepEqual(parse(compose(defaults, overlay, format, pointers), format), { map: { model: 'chosen' }, 'a/b': {}, nullable: null, numeric: { '1': 2 } });
    assert.deepEqual(parse(compose('{}', undefined, format, pointers), format), {});
  });

  test(`${format}: assignment/deletion overlaps and array indexing fail without values`, () => {
    for (const [override, deletion] of [[{ map: { key: 'secret-value' } }, '/map'], [{ map: 'secret-value' }, '/map/key'], [{ map: { key: 'secret-value' } }, '/map/key'], [{ items: ['secret-value'] }, '/items']]) {
      assert.throws(() => compose('{"map":{},"items":[]}', JSON.stringify(override), format, [deletion]), error => error.message.includes(deletion) && !error.message.includes('secret-value'));
    }
    for (const pointer of ['/items/0', '/items/0/key', '/items/-']) assert.throws(() => compose('{"items":[{"key":1}]}', undefined, format, [pointer]), /array elements/);
  });

  test(`${format}: removing overrides and deletions restores new defaults`, () => {
    const oldDefault = '{"chosen":"old","following":1,"removed":true}';
    const nextDefault = '{"chosen":"new","following":2,"removed":true}';
    const override = '{"chosen":"mine"}';
    assert.deepEqual(parse(compose(oldDefault, override, format, ['/removed']), format), { chosen: 'mine', following: 1 });
    assert.deepEqual(parse(compose(nextDefault, override, format, ['/removed']), format), { chosen: 'mine', following: 2 });
    assert.deepEqual(parse(compose(nextDefault, '{}', format), format), { chosen: 'new', following: 2, removed: true });
  });
}

test('YAML edits preserve unknown options, comments, order and quoted credentials', () => {
  const original = '# header\nknown: 1 # known comment\nadvanced:\n  # keep me\n  future: [a, b]\n';
  const changed = update(original, 'yaml', [{ path: ['known'], value: 2 }, { path: ['secret'], value: 'a$"\\\'`${X}' }]);
  assert.match(changed, /# header/); assert.match(changed, /# known comment/); assert.match(changed, /# keep me/);
  assert.deepEqual(parse(changed, 'yaml').advanced, { future: ['a', 'b'] });
  assert.equal(parse(changed, 'yaml').secret, 'a$"\\\'`${X}');
});

test('invalid native documents fail without echoing secret contents', () => {
  for (const [format, source] of [['yaml', 'secret: [sensitive'], ['json', '{"secret":"sensitive'], ['env', 'KEY="sensitive']]) {
    assert.throws(() => parse(source, format), error => !error.message.includes('sensitive'));
  }
});

test('dotenv standard quoting, comments and multiline values are literal', () => {
  const text = '# hi\nexport A=hello # note\nB="line\\nnext"\nC=\'${UNCHANGED}\\n\'\nD=`line\nnext`\n';
  assert.deepEqual(parse(text, 'env'), { A: 'hello', B: 'line\nnext', C: '${UNCHANGED}\\n', D: 'line\nnext' });
  assert.deepEqual(parseNativeEnv(text), parse(text, 'env'));
  assert.equal(update(text, 'env', []), text);
});

test('native dotenv quoting covers literal dollars, quotes and multiline values without a custom codec', () => {
  for (const value of ['', '$a ${B} \\n', 'one\ntwo', 'a\'"`\\$']) {
    const text = update('# keep\nKEY=old # explanation\nOTHER=untouched\n', 'env', [{ path: ['KEY'], value }]);
    assert.equal(parseNativeEnv(text).KEY, value);
    assert.match(text, /# keep/); assert.match(text, /OTHER=untouched/);
    assert.doesNotMatch(text, /ams:json/);
  }
});


test('YAML composition keeps applicable default and override comments, including replaced arrays', () => {
  const defaults = '# upstream header\nllm:\n  model: old # upstream model\n  timeout: 30 # upstream timeout\nitems:\n  - old # obsolete item\n# newly added setting\nfuture: true\n';
  const overlay = '# operator header\nllm:\n  model: custom # chosen model\nitems:\n  - replacement # replacement explanation\n';
  const output = compose(defaults, overlay, 'yaml');
  assert.match(output, /operator header/);
  assert.match(output, /chosen model/);
  assert.match(output, /upstream timeout/);
  assert.match(output, /newly added setting/);
  assert.match(output, /replacement explanation/);
  assert.doesNotMatch(output, /obsolete item/);
  assert.deepEqual(parse(output, 'yaml'), { llm: { model: 'custom', timeout: 30 }, items: ['replacement'], future: true });
});

test('dotenv composition preserves literal assignments and comments and distinguishes empty/deletion/inheritance', () => {
  const defaults = '# defaults\nKEEP=upstream # inherited\nCHANGED=old\nEMPTY=old\nDELETE=old\n';
  const literal = 'a\'"`\\$';
  const overlay = update('# operator\nCHANGED=unused # chosen\nEMPTY=\n', 'env', [{ path: ['CHANGED'], value: literal }]);
  const output = compose(defaults, overlay, 'env', ['/DELETE', '/ABSENT']);
  assert.deepEqual(parseNativeEnv(output), { KEEP: 'upstream', CHANGED: literal, EMPTY: '' });
  assert.match(output, /# inherited/);
  assert.match(output, /# operator/);
  assert.match(output, /# chosen/);
  assert.equal(parseNativeEnv(compose(defaults, '', 'env')).CHANGED, 'old');
  assert.throws(() => compose(defaults, 'DELETE=explicit\n', 'env', ['/DELETE']), /assigns and deletes/);
  assert.throws(() => compose(defaults, undefined, 'env', ['/KEEP/child']), /variable name/);
});

test('deletion metadata rejects malformed shapes, pointers, root deletion and unknown filenames', () => {
  const files = ['core.yaml', 'knowledge.env'];
  for (const value of [null, [], 'x', { unknown: ['/a'] }, { 'core.yaml': '/a' }, { 'core.yaml': [3] }, { 'core.yaml': [''] }, { 'core.yaml': ['a'] }, { 'core.yaml': ['/bad~2escape'] }]) assert.throws(() => validateNativeDeletions(value, files));
  assert.deepEqual(validateNativeDeletions({ 'core.yaml': ['/a~1b/~0', '/a~1b/~0'], 'knowledge.env': ['/KEY'] }, files), { 'core.yaml': ['/a~1b/~0'], 'knowledge.env': ['/KEY'] });
  assert.throws(() => compose('{}', undefined, 'json', ['']), /JSON Pointer/);
  // '/' names the empty object key, not the root in JSON Pointer.
  assert.deepEqual(parse(compose('{"":1,"kept":2}', undefined, 'json', ['/']), 'json'), { kept: 2 });
});

test('template diagnostics flag removed and type-changed overridden paths without exposing values', () => {
  const before = '{"removed":{"nested":"old-secret"},"type":1,"untouched":true,"same":1}';
  const after = '{"type":{},"untouched":false,"same":2}';
  const overlay = '{"removed":{"nested":"operator-secret"},"type":"operator-secret","same":3,"unknown":true}';
  const changes = nativeTemplateChanges(before, after, overlay, 'json');
  assert.deepEqual(changes.map(change => change.path), ['/removed', '/type']);
  assert.doesNotMatch(JSON.stringify(changes), /old-secret|operator-secret/);
  assert.deepEqual(nativeTemplateChanges(before, after, undefined, 'json'), []);
  assert.deepEqual(nativeTemplateChanges('A=old\nB=old\n', 'B=new\n', 'A=private\n', 'env').map(change => change.path), ['/A']);
});

test('native composition does not mutate object prototypes', () => {
  const text = compose('{"safe":true}', '{"__proto__":{"polluted":"value"},"constructor":{"prototype":{"x":1}}}', 'json');
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(parse(text, 'json'), JSON.parse('{"safe":true,"__proto__":{"polluted":"value"},"constructor":{"prototype":{"x":1}}}'));
});

test('YAML aliases compose independently and deleting an anchor leaves valid effective values', () => {
  const defaults = 'shared: &defaults\n  model: old\n  timeout: 30\nconsumer: *defaults\n';
  assert.deepEqual(parse(compose(defaults, 'shared:\n  model: chosen\n', 'yaml'), 'yaml'), { shared: { model: 'chosen', timeout: 30 }, consumer: { model: 'old', timeout: 30 } });
  assert.deepEqual(parse(compose(defaults, undefined, 'yaml', ['/shared']), 'yaml'), { consumer: { model: 'old', timeout: 30 } });
  assert.deepEqual(parse(compose(defaults, undefined, 'yaml', ['/shared/model']), 'yaml'), { shared: { timeout: 30 }, consumer: { model: 'old', timeout: 30 } });
  assert.throws(() => parse('cyclic: &secret\n  self: *secret\n', 'yaml'), error => !error.message.includes('secret'));
});

test('empty YAML overrides inherit, while explicit null is an override value', () => {
  for (const override of ['', '# explanation only\n', '---\n']) assert.deepEqual(parse(compose('value: default\n', override, 'yaml'), 'yaml'), { value: 'default' });
  assert.equal(parse(compose('value: default\n', 'null\n', 'yaml'), 'yaml'), null);
  assert.deepEqual(nativeTemplateChanges('value: old\n', '{}\n', '# no assignments\n', 'yaml'), []);
});


test('dotenv double-quote escapes retain stock backslashes instead of using JSON decoding', () => {
  const source = 'VALUE="quoted\\\"value\\nnext" # native comment\n';
  assert.equal(parseNativeEnv(source).VALUE, 'quoted\\"value\nnext');
  const value = "all'\"`quotes\r\nend";
  const text = update('', 'env', [{ path: ['VALUE'], value }]);
  assert.doesNotMatch(text, /ams:json/);
  assert.equal(parseNativeEnv(text).VALUE, value.replaceAll('"', '\\"'));
});
