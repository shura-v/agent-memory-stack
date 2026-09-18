import test from 'node:test';
import assert from 'node:assert/strict';
import { detectExistingInstallation } from '../dist/runtime/installation.js';
import { ProcessFailure, runProcess } from '../dist/runtime/process.js';
import { serviceNames } from '../dist/deployment/model.js';

const project = 'ams-0123456789';
const containers = (services = serviceNames, labels = {}) => services.map((service, index) => ({
  Id: (index + 1).toString(16).padStart(64, '0'), State: { Status: 'exited' },
  Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service, ...labels } },
}));
function runner(engines) {
  const calls = [];
  return { calls, async run(request) {
    calls.push(request);
    const state = engines[request.command];
    if (state instanceof Error) throw state;
    if (request.args[0] === 'ps') { assert.deepEqual(request.args, ['ps', '-aq']); return (state ?? []).map(container => container.Id).join('\n'); }
    assert.deepEqual(request.args, ['inspect', ...state.map(container => container.Id)]);
    return JSON.stringify(state);
  } };
}

test('complete stopped stack is detected before setup through either visible engine', async () => {
  for (const engine of ['docker', 'podman']) {
    const fake = runner({ [engine]: containers(undefined, { 'com.docker.compose.project.working_dir': '/tmp/my-stack' }) });
    assert.deepEqual(await detectExistingInstallation(fake.run), { engine, project, directory: '/tmp/my-stack' });
    assert.ok(fake.calls.every(call => ['ps', 'inspect'].includes(call.args[0])));
  }
});

test('incomplete stacks, helper containers and unrelated project names do not count', async () => {
  for (const candidates of [
    containers(serviceNames.slice(1)),
    containers(['core', 'config', 'bootstrap', 'access', 'knowledge-service']),
    containers(undefined, { 'com.docker.compose.project': 'other-stack' }),
    containers(undefined, { 'com.docker.compose.project': 'ams-0123456789-extra' }),
  ]) assert.equal(await detectExistingInstallation(runner({ docker: candidates }).run), undefined);
});

test('partial stacks never combine across project labels or Docker and Podman', async () => {
  const first = containers(serviceNames.slice(0, 2));
  const second = containers(serviceNames.slice(2));
  assert.equal(await detectExistingInstallation(runner({ docker: first, podman: second }).run), undefined);
  for (const container of second) container.Config.Labels['com.docker.compose.project'] = 'ams-abcdef0123';
  assert.equal(await detectExistingInstallation(runner({ docker: [...first, ...second] }).run), undefined);
});

test('directory labels are optional, sanitized and must agree within the detected project', async () => {
  const podman = containers(undefined, { 'io.podman.compose.project.working_dir': '/tmp/podman-stack' });
  assert.equal((await detectExistingInstallation(runner({ podman }).run)).directory, '/tmp/podman-stack');
  for (const directory of ['relative/path', '/tmp/../private', '/tmp/stack\nsecret', '/tmp/stack\u001b[31m', '/tmp/\u202esecret']) {
    const fake = runner({ docker: containers(undefined, { 'com.docker.compose.project.working_dir': directory }) });
    assert.deepEqual(await detectExistingInstallation(fake.run), { engine: 'docker', project });
  }
  const conflicting = containers(undefined, { 'com.docker.compose.project.working_dir': '/tmp/a' });
  conflicting[0].Config.Labels['io.podman.compose.project.working_dir'] = '/tmp/b';
  assert.deepEqual(await detectExistingInstallation(runner({ docker: conflicting }).run), { engine: 'docker', project });
});

test('missing or unavailable engines and malformed metadata leave fresh setup available', async () => {
  const missing = new ProcessFailure('Cannot execute docker');
  assert.equal(await detectExistingInstallation(runner({ docker: missing, podman: missing }).run), undefined);
  assert.deepEqual(await detectExistingInstallation(runner({ docker: missing, podman: containers() }).run), { engine: 'podman', project });
  for (const output of ['invalid JSON', '{}', '[null, 12, {"Config":{"Labels":[]}}]']) {
    assert.equal(await detectExistingInstallation(async ({ args }) => args[0] === 'ps' ? 'a'.repeat(64) : output), undefined);
  }
  await assert.rejects(detectExistingInstallation(async () => { throw new TypeError('unexpected programming failure'); }), TypeError);
});

test('container discovery commands are bounded and stalled child processes terminate', async () => {
  const fake = runner({ docker: containers() });
  await detectExistingInstallation(fake.run);
  assert.ok(fake.calls.every(call => call.timeoutMs === 5000));
  await assert.rejects(runProcess({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 50 }), ProcessFailure);
});


test('complete pre-MCP installations remain protected from repeat setup', async () => {
  const old = containers(serviceNames.filter(service => service !== 'mcp'));
  assert.deepEqual(await detectExistingInstallation(runner({ docker: old }).run), { engine: 'docker', project });
});
