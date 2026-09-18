import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessFailure, runProcess } from '../dist/runtime/process.js';

const prefix = 'Bootstrap failed: ';
const failure = (stderr, options = {}) => runProcess({
  command: process.execPath,
  args: ['-e', `process.stderr.write(${JSON.stringify(stderr)}); process.exit(1)`],
  label: 'Administrator initialization',
  input: 'synthetic-stdin-secret',
  ...options,
});

test('owned error prefix reveals only the sanitized line, with explicit opt-in', async () => {
  const stderr = `upstream synthetic-token-secret\n${prefix}Administrator key was rejected\nengine synthetic-engine-secret\n`;
  await assert.rejects(failure(stderr, { safeErrorPrefix: prefix }), error => {
    assert.ok(error instanceof ProcessFailure);
    assert.equal(error.exitCode, 1);
    assert.equal(error.message, 'Administrator initialization failed (exit 1): Bootstrap failed: Administrator key was rejected');
    assert.doesNotMatch(error.message, /synthetic-|process\.stderr/);
    return true;
  });
  await assert.rejects(failure(stderr), error => {
    assert.equal(error.message, "Administrator initialization failed (exit 1); inspect this service's local container logs");
    return true;
  });
});

test('unsafe, oversized and embedded diagnostic lines remain hidden', async () => {
  for (const stderr of [
    `engine: ${prefix}synthetic-secret\n`,
    `${prefix}${'x'.repeat(1024)}synthetic-secret\n`,
    `${prefix}synthetic-secret\u001b[2J\n`,
    `upstream synthetic-secret\n`,
  ]) {
    await assert.rejects(failure(stderr, { safeErrorPrefix: prefix }), error => {
      assert.equal(error.message, "Administrator initialization failed (exit 1); inspect this service's local container logs");
      return true;
    });
  }
});

test('prefixed errors survive chunk boundaries and a missing final newline', async () => {
  await assert.rejects(runProcess({
    command: process.execPath,
    args: ['-e', "process.stderr.write('Bootstrap fai'); setTimeout(() => { process.stderr.write('led: Core is unavailable'); process.exit(1); }, 30)"],
    label: 'Initialization', safeErrorPrefix: prefix,
  }), /Initialization failed \(exit 1\): Bootstrap failed: Core is unavailable$/);
});

test('invalid safe error prefixes are rejected before execution', async () => {
  for (const safeErrorPrefix of ['', 'unsafe\nprefix', 'x'.repeat(101)]) {
    await assert.rejects(failure('', { safeErrorPrefix }), /Invalid safe error prefix/);
  }
});

test('Compose diagnostics routed through stdout are opt-in and successful output stays intact', async () => {
  const stdout = `provider synthetic-secret\n${prefix}Core is unavailable\n`;
  const request = {
    command: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(stdout)}); process.exit(1)`],
    label: 'Initialization',
  };
  await assert.rejects(runProcess({ ...request, safeErrorPrefix: prefix }), error => {
    assert.equal(error.exitCode, 1);
    assert.equal(error.message, 'Initialization failed (exit 1): Bootstrap failed: Core is unavailable');
    return true;
  });
  await assert.rejects(runProcess(request), error => {
    assert.equal(error.message, "Initialization failed (exit 1); inspect this service's local container logs");
    return true;
  });
  assert.equal(await runProcess({ ...request,
    args: ['-e', `process.stdout.write(${JSON.stringify(stdout)})`], safeErrorPrefix: prefix,
  }), stdout);
});

test('stdout and stderr fragments never combine into a trusted diagnostic', async () => {
  for (const [first, second] of [['stdout', 'stderr'], ['stderr', 'stdout']]) {
    await assert.rejects(runProcess({
      command: process.execPath,
      args: ['-e', `process.${first}.write('Bootstrap fai'); setTimeout(() => { process.${second}.write('led: synthetic-secret\\n'); process.exit(1); }, 30)`],
      label: 'Initialization', safeErrorPrefix: prefix,
    }), error => {
      assert.equal(error.message, "Initialization failed (exit 1); inspect this service's local container logs");
      return true;
    });
  }
});


test('Podman provider style resets before the owned prefix do not hide the error', async () => {
  await assert.rejects(failure(`\u001b[4mPodman provider banner\n\n\u001b[0m${prefix}Synthetic diagnostic probe\n`, { safeErrorPrefix: prefix }), error => {
    assert.equal(error.message, 'Administrator initialization failed (exit 1): Bootstrap failed: Synthetic diagnostic probe');
    assert.equal(error.exitCode, 1);
    return true;
  });
});
