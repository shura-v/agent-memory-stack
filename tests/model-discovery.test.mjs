import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { discoverModels, ModelAccessError } from '../dist/setup/model-discovery.js';

async function server(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP discovery preserves the API prefix and exact Bearer key', async t => {
  const key = 'synthetic-\'"\\$literal';
  let count = 0;
  const base = await server(t, (req, res) => {
    count++;
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/provider/v4/models');
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'model-z' }, { id: 'provider/model-a' }, { id: 'model-z' }] }));
  });
  assert.deepEqual(await discoverModels(base + '/provider/v4/', key), ['model-z', 'provider/model-a']);
  assert.equal(count, 1);
});

test('redirect discovery never follows or forwards credentials to its destination', async t => {
  let destinationRequests = 0;
  const destination = await server(t, (_req, res) => { destinationRequests++; res.end('{"data":[]}'); });
  const base = await server(t, (_req, res) => { res.writeHead(307, { location: destination + '/models' }); res.end(); });
  assert.deepEqual(await discoverModels(base + '/v1', 'synthetic-key'), []);
  assert.equal(destinationRequests, 0);
});

test('failed, malformed, and empty discovery returns manual-entry fallback', async () => {
  for (const [status, body] of [[404, 'not supported'], [405, 'not supported'], [500, 'failure'], [200, 'not JSON'], [200, '{}'], [200, '{"data":{}}'], [200, '{"data":[]}']]) {
    assert.deepEqual(await discoverModels('https://provider.invalid/v1', 'synthetic-key', async () => new Response(body, { status })), []);
  }
  assert.deepEqual(await discoverModels('https://provider.invalid/v1', 'synthetic-key', async () => { throw new Error('private network details'); }), []);
});

test('access rejection is distinct from unavailable discovery and does not disclose response details', async () => {
  for (const status of [401, 403]) {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    await assert.rejects(discoverModels('https://provider.invalid/v1', 'private-key', async () => new Response(body, {status})), error => {
      assert.ok(error instanceof ModelAccessError);
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /private-key/);
      return true;
    });
    assert.equal(cancelled, true);
  }
});

test('model IDs are deduplicated and terminal control characters are rejected', async () => {
  const payload = { data: [null, 'model', {}, { id: 123 }, { id: '' }, { id: ' ' }, { id: ' leading' }, { id: 'trailing ' },
    { id: 'bad\nline' }, { id: '\u001b[31mred' }, { id: 'bad\u009bcontrol' }, { id: 'good/model:latest' }, { id: 'good/model:latest' }] };
  assert.deepEqual(await discoverModels('https://provider.invalid/custom/v4', 'synthetic-key', async () => Response.json(payload)), ['good/model:latest']);
});

test('invalid URL or credentials are rejected before sending a request', async () => {
  const fetcher = async () => { assert.fail('invalid inputs must not send a request'); };
  for (const base of ['file:///models', 'https://user:password@provider.invalid/v1', 'https://provider.invalid/v1?key=private', 'https://provider.invalid/v1#fragment', 'https://provider.invalid/v1/chat/completions']) {
    assert.deepEqual(await discoverModels(base, 'synthetic-key', fetcher), []);
  }
  for (const key of ['', ' bad ', 'key\nextra']) assert.deepEqual(await discoverModels('https://provider.invalid/v1', key, fetcher), []);
});

test('response size is bounded by declared length and streamed bytes', async () => {
  let declaredCancelled = false;
  const declared = new ReadableStream({ cancel() { declaredCancelled = true; } });
  assert.deepEqual(await discoverModels('https://provider.invalid/v1', 'synthetic-key', async () => new Response(declared, { headers: { 'content-length': String(1024 * 1024 + 1) } })), []);
  assert.equal(declaredCancelled, true);
  let streamedCancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { streamedCancelled = true; } });
  assert.deepEqual(await discoverModels('https://provider.invalid/v1', 'synthetic-key', async () => new Response(stream)), []);
  assert.equal(streamedCancelled, true);
});

test('five-second overall timeout aborts a hanging fetch and returns an empty list', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = discoverModels('https://provider.invalid/v1', 'synthetic-key', async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(4999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, []);
  assert.equal(signal.aborted, true);
});

test('overall timeout also bounds a stalled response body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = discoverModels('https://provider.invalid/v1', 'synthetic-key', async () => new Response(body));
  await Promise.resolve();
  t.mock.timers.tick(5000);
  assert.deepEqual(await pending, []);
  assert.equal(cancelled, true);
});
