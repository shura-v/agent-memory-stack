import test from 'node:test';
import assert from 'node:assert/strict';
import { reservePublishedPorts } from '../dist/runtime/ports.js';
import { PortBindingConflict } from '../dist/runtime/errors.js';
import { ProcessFailure, runProcess } from '../dist/runtime/process.js';
import { imageServices } from '../dist/build/images.js';

const manifest = { schemaVersion: 1, images: Object.fromEntries(imageServices.map((service, index) => [service, { id: 'sha256:' + String(index + 1).repeat(64), tag: `${service}:test`, platform: 'linux/arm64', repoDigests: [] }])) };
const listener = (service, field, port, target = port) => ({ service, field, port, target, audience: 'user' });
const proxy = listener('memory-proxy', 'MEMORY_PROXY_PORT', 8096);
const panel = listener('panel', 'PANEL_PORT', 8123);
function container(id, service, port, target = port, project = 'ams-test', ip = '127.0.0.1') {
  return { Id: id, Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service } }, State: { Running: true }, NetworkSettings: { Ports: { [`${target}/tcp`]: [{ HostIp: ip, HostPort: String(port) }] } } };
}
function engine({ existing = [], fail, assigned = 49000, corrupt = false } = {}) {
  const calls = [], helpers = new Map();
  return { calls, helpers, async run(request) {
    calls.push(request);
    const args = request.args;
    if (args[0] === 'ps') return (args.includes('-aq') ? [...helpers.values()] : existing).map(item => item.Id).join('\n');
    if (args[0] === 'inspect') return JSON.stringify(args.slice(1).map(id => helpers.get(id) ?? existing.find(item => item.Id === id)));
    if (args[0] === 'run') {
      const name = args[args.indexOf('--name') + 1];
      const publication = args[args.indexOf('--publish') + 1];
      const [, preferred, target] = publication.split(':');
      const helper = container(name, undefined, preferred || assigned++, target);
      helper.Config.Labels = Object.fromEntries(args.flatMap((value, index) => value === '--label' ? [args[index + 1].split('=')] : []));
      helpers.set(name, helper);
      if (fail) await fail(request, preferred);
      if (corrupt) helper.NetworkSettings.Ports[`${target}/tcp`][0].HostIp = '0.0.0.0';
      return name;
    }
    if (args[0] === 'rm') { for (const id of args.slice(2)) helpers.delete(id); return ''; }
    throw new Error(`Unexpected fake-engine command ${args[0]}`);
  } };
}

test('reserves actual engine publications, keeps distinct ports and releases only operation-labelled helpers', async () => {
  const unrelated = container('unrelated', 'panel', 9000, 9000, 'other-project');
  const fake = engine({ existing: [unrelated] });
  const result = await reservePublishedPorts('podman', 'ams-test', manifest, [proxy, panel], fake.run);
  assert.deepEqual(result.ports, { MEMORY_PROXY_PORT: '8096', PANEL_PORT: '8123' });
  const starts = fake.calls.filter(call => call.args[0] === 'run');
  assert.equal(starts.length, 2);
  for (const call of starts) {
    assert.equal(call.command, 'podman');
    assert.equal(call.classifyPortConflict, true);
    assert.equal(call.input, undefined);
    assert.equal(call.env, undefined);
    assert.ok(call.args.includes(manifest.images.runtime.id));
    assert.ok(call.args.includes('--pull=never'));
    assert.match(call.args[call.args.indexOf('--publish') + 1], /^127\.0\.0\.1:/);
    assert.ok(!call.args.includes('-v'));
  }
  assert.equal(fake.helpers.size, 2);
  await result.release();
  await result.release();
  assert.equal(fake.helpers.size, 0);
  assert.ok(!fake.calls.filter(call => call.args[0] === 'rm').some(call => call.args.includes('unrelated')));
  assert.equal(fake.calls.filter(call => call.args[0] === 'rm').length, 1);
});

test('reuses only exact running project, service, target and loopback publication', async () => {
  const fake = engine({ existing: [container('own-proxy', 'memory-proxy', 8096), container('other-panel', 'panel', 8123, 8123, 'other-project')] });
  const result = await reservePublishedPorts('docker', 'ams-test', manifest, [proxy, panel], fake.run);
  assert.equal(fake.calls.filter(call => call.args[0] === 'run').length, 1);
  assert.deepEqual(result.ports, { MEMORY_PROXY_PORT: '8096', PANEL_PORT: '8123' });
  await result.release();
  for (const wrong of [container('wrong-service', 'core', 8096), container('wrong-target', 'memory-proxy', 8096, 8000), container('public', 'memory-proxy', 8096, 8096, 'ams-test', '0.0.0.0')]) {
    const next = engine({ existing: [wrong] });
    const reservation = await reservePublishedPorts('docker', 'ams-test', manifest, [proxy], next.run);
    assert.equal(next.calls.filter(call => call.args[0] === 'run').length, 1);
    await reservation.release();
  }
});

test('confirmed bind conflict falls back to engine allocation and removes failed helper too', async () => {
  const fake = engine({ fail: async (_request, preferred) => { if (preferred) throw new PortBindingConflict('busy'); } });
  const result = await reservePublishedPorts('podman', 'ams-test', manifest, [proxy], fake.run);
  assert.deepEqual(result.ports, { MEMORY_PROXY_PORT: '49000' });
  const starts = fake.calls.filter(call => call.args[0] === 'run');
  assert.equal(starts.length, 2);
  assert.ok(starts[1].args.includes('127.0.0.1::8096'));
  await result.release();
  assert.equal(fake.helpers.size, 0);
});

test('duplicate preferences request distinct automatic bindings; generic engine failure never falls back', async () => {
  const duplicate = engine();
  const result = await reservePublishedPorts('podman', 'ams-test', manifest, [proxy, listener('panel', 'PANEL_PORT', 8096, 8123)], duplicate.run);
  assert.deepEqual(result.ports, { MEMORY_PROXY_PORT: '8096', PANEL_PORT: '49000' });
  await result.release();
  const failed = engine({ fail: async () => { throw new ProcessFailure('podman failed (exit 125)'); } });
  await assert.rejects(reservePublishedPorts('podman', 'ams-test', manifest, [proxy], failed.run), ProcessFailure);
  assert.equal(failed.calls.filter(call => call.args[0] === 'run').length, 1);
  assert.equal(failed.helpers.size, 0);
});

test('invalid helper publication fails closed and cleans up earlier successful reservations', async () => {
  const fake = engine({ corrupt: true });
  await assert.rejects(reservePublishedPorts('docker', 'ams-test', manifest, [proxy], fake.run), /Cannot verify the reserved loopback port/);
  assert.equal(fake.helpers.size, 0);
  const later = engine({ fail: async (_request, preferred) => { if (preferred === '8123') throw new ProcessFailure('permission denied'); } });
  await assert.rejects(reservePublishedPorts('docker', 'ams-test', manifest, [proxy, panel], later.run), /permission denied/);
  assert.equal(later.helpers.size, 0);
});

test('process failure classification is opt-in, recognizes binding failures and never reveals stderr', async () => {
  const diagnostics = [
    'Error: rootlessport listen tcp 127.0.0.1:8096: bind: address already in use',
    'Bind for 127.0.0.1:8096 failed: port is already allocated',
  ];
  for (const diagnostic of diagnostics) {
    for (const enabled of [false, true]) {
      await assert.rejects(runProcess({ command: process.execPath, args: ['-e', `process.stderr.write(${JSON.stringify(diagnostic + ' secret-token')}); process.exit(125)`], label: 'Reserve panel host port', classifyPortConflict: enabled }), error => {
        assert.equal(error instanceof PortBindingConflict, enabled);
        assert.doesNotMatch(error.message, /secret-token|127\.0\.0\.1|8096/);
        return true;
      });
    }
  }
  await assert.rejects(runProcess({ command: process.execPath, args: ['-e', "process.stderr.write('Error: permission denied secret-token'); process.exit(125)"], classifyPortConflict: true }), error => error instanceof ProcessFailure && !error.message.includes('secret-token'));
});
