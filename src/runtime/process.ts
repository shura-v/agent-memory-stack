import { spawn } from 'node:child_process';
import { PortBindingConflict } from './errors.js';

export type Command = { command: string; args: string[]; cwd?: string; input?: string; interactive?: boolean; env?: NodeJS.ProcessEnv; label?: string; classifyPortConflict?: boolean; timeoutMs?: number; safeErrorPrefix?: string };
export type Runner = (command: Command) => Promise<string>;
export class ProcessFailure extends Error {
  constructor(message: string, readonly exitCode?: number | null) { super(message); }
}
export const runProcess: Runner = ({ command, args, cwd, input, interactive, env, label, classifyPortConflict, timeoutMs, safeErrorPrefix }) => new Promise((resolve, reject) => {
  if (safeErrorPrefix !== undefined && (!safeErrorPrefix.length || safeErrorPrefix.length > 100 || /[\u0000-\u001f\u007f]/.test(safeErrorPrefix))) {
    reject(new ProcessFailure('Invalid safe error prefix'));
    return;
  }
  const child = spawn(command, args, { cwd, env: env ?? process.env, shell: false, timeout: timeoutMs, killSignal: 'SIGKILL',
    stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
  let output = '';
  // Runtime/upstream output may contain credentials. Errors intentionally report
  // only the executable and status unless an owned command explicitly opts in
  // to a prefix reserved for its sanitized errors. Never forward other lines.
  let diagnostic = '';
  let portConflict = false;
  let safeDiagnostic = '';
  const safeOutputReader = () => {
    let line = '';
    let oversizedLine = false;
    const finishLine = () => {
      // Podman's provider banner can leave an ANSI style reset before the next line.
      const candidate = line.replace(/^(?:\u001b\[[0-9;]*m)+/, '').replace(/\r$/, '');
      if (!safeDiagnostic && !oversizedLine && safeErrorPrefix && candidate.startsWith(safeErrorPrefix)
        && candidate.length > safeErrorPrefix.length && !/[\u0000-\u001f\u007f]/.test(candidate)) safeDiagnostic = candidate;
      line = '';
      oversizedLine = false;
    };
    return { finishLine, write(text: string) {
      if (!safeErrorPrefix || safeDiagnostic) return;
      const parts = text.split('\n');
      for (let index = 0; index < parts.length; index++) {
        if (!oversizedLine) {
          line += parts[index];
          if (line.length > 1024) { line = ''; oversizedLine = true; }
        }
        if (index < parts.length - 1) finishLine();
      }
    } };
  };
  // Compose providers can route container stderr through stdout. Each stream
  // needs its own line buffer so fragments can never form a synthetic error.
  const safeStdout = safeOutputReader();
  const safeStderr = safeOutputReader();
  child.stdout?.on('data', chunk => {
    const text = String(chunk);
    output += text;
    if (output.length > 2_000_000) child.kill();
    safeStdout.write(text);
  });
  child.stderr?.on('data', chunk => {
    const text = String(chunk);
    if (classifyPortConflict) {
      diagnostic = (diagnostic + text).slice(-8192);
      portConflict ||= /(?:bind|listen)(?:[^\n]{0,300})address already in use|port is already allocated|requested port is already allocated|address already in use(?:[^\n]{0,120})(?:bind|listen)/i.test(diagnostic);
    }
    safeStderr.write(text);
  });
  child.on('error', () => reject(new ProcessFailure(`Cannot execute ${command}; check installation and permissions`)));
  child.on('close', code => {
    safeStdout.finishLine();
    safeStderr.finishLine();
    if (code === 0) resolve(output);
    else reject(portConflict
      ? new PortBindingConflict(`${label ?? command}: host port is already in use`)
      : new ProcessFailure(`${label ?? command} failed (exit ${code})${safeDiagnostic ? `: ${safeDiagnostic}` : "; inspect this service's local container logs"}`, code));
  });
  child.stdin?.on('error', () => {});
  child.stdin?.end(input);
});
