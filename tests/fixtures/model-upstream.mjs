// Synthetic LLM for model-smoke only. No provider credentials or external calls.
import http from 'node:http';

const events = [];
const answer = 'AMS synthetic assistant response, persisted as L0.';
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return res.end('ok');
  if (req.method === 'GET' && req.url === '/events') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(events));
  }
  if (req.method !== 'POST' || !['/v1/responses', '/v1/chat/completions'].includes(req.url)) {
    res.writeHead(404); return res.end();
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const event = { path: req.url, body, receivedAt: Date.now(), completed: false, closed: false,
    taskHeader: req.headers['x-task-id'] ?? null };
  events.push(event);
  let timer;
  res.on('close', () => { clearTimeout(timer); event.closed = true; event.closedAt = Date.now(); });
  const cancel = JSON.stringify(body.input ?? body.messages).includes('AMS_CANCEL_SMOKE');
  const id = `resp_fixture_${events.length}`;
  const output = [{ id: `msg_${events.length}`, type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: answer, annotations: [] }] }];
  const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), model: body.model,
    status: 'completed', output, output_text: answer, usage: { input_tokens: 10, output_tokens: 9, total_tokens: 19 } };
  if (req.url === '/v1/chat/completions' && body.stream !== true) {
    event.completed = true;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ id, object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 9, total_tokens: 19 } }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  send({ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } });
  send({ type: 'response.output_item.added', output_index: 0, item: { ...output[0], status: 'in_progress', content: [] } });
  send({ type: 'response.output_text.delta', item_id: output[0].id, output_index: 0, content_index: 0, delta: answer });
  event.firstChunkAt = Date.now();
  // The cancel case remains open until the real Proxy/Hono client disconnects.
  // This cap prevents a failed test leaving a permanently open fixture stream.
  timer = setTimeout(() => {
    send({ type: 'response.output_text.done', item_id: output[0].id, output_index: 0, content_index: 0, text: answer });
    send({ type: 'response.completed', response });
    event.completed = true;
    res.end();
  }, cancel ? 60_000 : 500);
});
server.listen(8090, '0.0.0.0');
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
