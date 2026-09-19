import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configurationDirectory, displayHomePath } from '../dist/setup/paths.js';

test('setup displays the current home prefix without changing relative or unrelated paths', () => {
  assert.equal(displayHomePath(homedir()), '~');
  assert.equal(displayHomePath(join(homedir(), 'ams', 'data')), '~/ams/data');
  for (const path of ['./ams', './data', '/srv/ams', `${homedir()}-other/ams`, `prefix${homedir()}/ams`]) {
    assert.equal(displayHomePath(path), path);
  }
});

test('configuration has a fixed location under the current user home', () => {
  assert.equal(configurationDirectory(), join(homedir(), '.agent-memory-stack'));
});
