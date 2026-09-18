import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AccessError } from './user-auth.js';

export interface McpWorker {
  url: string;
  sessions: Map<string, { touched: number; active: number }>;
  pending: number;
  alive(): boolean;
  stop(): Promise<void>;
}
export type WorkerFactory = (key: string) => Promise<McpWorker>;
export interface WorkerLease { worker: McpWorker; release(): void; discard(): Promise<void> }
export class McpWorkers {
  private readonly entries = new Map<string, { promise: Promise<McpWorker>; active: number; touched: number }>();
  private readonly timer: NodeJS.Timeout;
  private closed = false;
  constructor(private readonly factory: WorkerFactory, private readonly maximum = 8, private readonly idleMs = 300_000) {
    this.timer = setInterval(() => void this.expire().catch(() => {}), Math.min(idleMs, 30_000));
    this.timer.unref();
  }
  async acquire(context: string, key: string): Promise<WorkerLease> {
    if (this.closed) throw new AccessError(503, 'MCP is stopping');
    let entry = this.entries.get(context);
    if (!entry) {
      if (this.entries.size >= this.maximum) throw new AccessError(503, 'MCP worker capacity reached');
      entry = { promise: Promise.resolve().then(() => this.factory(key)), active: 0, touched: Date.now() };
      this.entries.set(context, entry);
    }
    entry.active++;
    let worker: McpWorker;
    try {
      worker = await entry.promise;
      if (!worker.alive() || this.closed) { await worker.stop(); throw new AccessError(503, 'MCP worker unavailable'); }
    } catch {
      entry.active--;
      if (this.entries.get(context) === entry) this.entries.delete(context);
      throw new AccessError(503, 'MCP worker unavailable');
    }
    let released = false;
    let stopping: Promise<void> | undefined;
    return {
      worker,
      release: () => { if (!released) { released = true; entry!.active--; entry!.touched = Date.now(); } },
      discard: () => {
        // Evict before awaiting shutdown so another request can create a replacement.
        // A stale lease must never remove that replacement's entry.
        if (this.entries.get(context) === entry) this.entries.delete(context);
        return stopping ??= worker.stop();
      },
    };
  }
  async expire(): Promise<void> {
    await Promise.all([...this.entries].map(async ([id, entry]) => {
      if (entry.active || Date.now() - entry.touched < this.idleMs) return;
      this.entries.delete(id);
      await entry.promise.then(worker => worker.stop(), () => {});
    }));
  }
  async close(): Promise<void> {
    this.closed = true; clearInterval(this.timer);
    const entries = [...this.entries.values()]; this.entries.clear();
    await Promise.all(entries.map(entry => entry.promise.then(worker => worker.stop(), () => {})));
  }
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stopGroup(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const signal = (name: NodeJS.Signals) => { try { process.kill(-child.pid!, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } };
  signal('SIGTERM');
  await delay(200);
  signal('SIGKILL');
}
export function supergatewayFactory(knowledgeToolsUrl: string, serviceId: string): WorkerFactory {
  const require = createRequire(import.meta.url);
  const executable = join(dirname(require.resolve('supergateway/package.json')), 'dist/index.js');
  const adapter = fileURLToPath(new URL('./mcp-adapter.js', import.meta.url));
  // The shell command consists only of packaged paths. The credential is never an argument.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return async key => {
    const port = await freePort();
    const child = spawn(process.execPath, [executable, '--stdio', `${quote(process.execPath)} ${quote(adapter)}`,
      '--outputTransport', 'streamableHttp', '--stateful', '--streamableHttpPath', '/mcp', '--port', String(port),
      '--sessionTimeout', '300000', '--healthEndpoint', '/health', '--logLevel', 'none'], {
      detached: true, stdio: 'ignore', env: { PATH: process.env.PATH, NODE_ENV: 'production',
        AMS_MCP_USER_KEY: key, AMS_MCP_KNOWLEDGE_URL: knowledgeToolsUrl, AMS_MCP_SERVICE_ID: serviceId },
    });
    let dead = false;
    let stopped: Promise<void> | undefined;
    child.once('error', () => { dead = true; });
    child.once('exit', () => { dead = true; stopped ??= stopGroup(child); void stopped.catch(() => {}); });
    const worker: McpWorker = { url: `http://127.0.0.1:${port}/mcp`, sessions: new Map(), pending: 0,
      alive: () => !dead && !stopped, stop: () => stopped ??= stopGroup(child) };
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (dead) throw new Error();
        try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(100) })).ok) return worker; } catch {}
        await delay(50);
      }
      throw new Error();
    } catch { await worker.stop(); throw new AccessError(503, 'MCP worker failed to start'); }
  };
}
