import { spawn } from 'node:child_process';
import { PortBindingConflict } from './errors.js';

export type Command = { command: string; args: string[]; cwd?: string; input?: string; interactive?: boolean; env?: NodeJS.ProcessEnv; label?: string; classifyPortConflict?: boolean; timeoutMs?: number };
export type Runner = (command: Command) => Promise<string>;
export class ProcessFailure extends Error {}
export const runProcess: Runner = ({ command, args, cwd, input, interactive, env, label, classifyPortConflict, timeoutMs }) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env: env ?? process.env, shell: false, timeout: timeoutMs, killSignal: 'SIGKILL',
    stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); if (output.length > 2_000_000) child.kill(); });
  // Runtime/upstream stderr may contain credentials. Errors intentionally report
  // only the executable and status; operators can inspect local logs themselves.
  // Retain only a bounded classification window, never include it in errors.
  let diagnostic = '';
  let portConflict = false;
  child.stderr?.on('data', chunk => {
    if (!classifyPortConflict) return;
    diagnostic = (diagnostic + String(chunk)).slice(-8192);
    portConflict ||= /(?:bind|listen)(?:[^\n]{0,300})address already in use|port is already allocated|requested port is already allocated|address already in use(?:[^\n]{0,120})(?:bind|listen)/i.test(diagnostic);
  });
  child.on('error', () => reject(new ProcessFailure(`Cannot execute ${command}; check installation and permissions`)));
  child.on('close', code => code === 0 ? resolve(output) : reject(portConflict
    ? new PortBindingConflict(`${label ?? command}: host port is already in use`)
    : new ProcessFailure(`${label ?? command} failed (exit ${code}); inspect this service's local container logs`)));
  child.stdin?.on('error', () => {});
  child.stdin?.end(input);
});
