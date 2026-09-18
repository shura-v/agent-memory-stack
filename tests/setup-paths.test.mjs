import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { displayHomePath, expandHomePath } from '../dist/setup/paths.js';

test('setup displays the current home prefix without changing relative or unrelated paths', () => {
  assert.equal(displayHomePath(homedir()), '~');
  assert.equal(displayHomePath(join(homedir(), 'ams', 'data')), '~/ams/data');
  for (const path of ['./ams', './data', '/srv/ams', `${homedir()}-other/ams`, `prefix${homedir()}/ams`]) {
    assert.equal(displayHomePath(path), path);
  }
});

test('setup expands home shorthand and preserves relative path semantics', () => {
  assert.equal(expandHomePath('~'), homedir());
  assert.equal(expandHomePath('~/ams/data'), join(homedir(), 'ams', 'data'));
  for (const path of ['./ams', './data', '/srv/ams', '~someone/ams', 'directory/~/data']) {
    assert.equal(expandHomePath(path), path);
  }
});
