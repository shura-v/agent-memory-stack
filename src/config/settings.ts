import { randomBytes } from 'node:crypto';
import { resolveDeployment } from '../deployment/model.js';
import { accountProviders } from './providers.js';
import { internalLLM, usesLocalInternalModels } from './internal-llm.js';

export type Field = { name: string; label: string; default?: string; placeholder?: string; secret?: boolean; role?: 'core' | 'cliproxy'; choices?: string[] };
export const fields: Field[] = [
  ...['CORE', 'CLIPROXY', 'KNOWLEDGE'].map(prefix => ({ name: `${prefix}_SERVICE_ENABLED`, label: `Allow ${prefix} service connections from another machine`, default: 'false', choices: ['false', 'true'] })),
  { name: 'KNOWLEDGE_TOOLS_PUBLIC_ENABLED', label: 'Expose authenticated Knowledge HTTP tools', default: 'false', choices: ['false', 'true'] },
  { name: 'CORE_SERVICE_PORT', label: 'Core authenticated service loopback port', default: '8420' },
  { name: 'CLIPROXY_SERVICE_PORT', label: 'CLIProxyAPI authenticated service loopback port', default: '8317' },
  { name: 'KNOWLEDGE_SERVICE_PORT', label: 'Knowledge authenticated service loopback port', default: '8423' },
  { name: 'MEMORY_PROXY_PORT', label: 'MemoryProxy loopback port', default: '8096' },
  { name: 'KNOWLEDGE_PORT', label: 'Knowledge loopback port', default: '8422' },
  { name: 'MCP_PORT', label: 'MCP loopback port', default: '8425' },
  { name: 'PANEL_PORT', label: 'Panel loopback port', default: '8123' },
  { name: 'MEMORY_PROXY_PUBLIC_URL', label: 'MemoryProxy HTTP(S) origin', default: 'http://127.0.0.1:8096' },
  { name: 'KNOWLEDGE_PUBLIC_URL', label: 'Knowledge HTTP(S) origin', default: 'http://127.0.0.1:8422' },
  { name: 'PANEL_PUBLIC_URL', label: 'Panel HTTP(S) origin', default: 'http://127.0.0.1:8123' },
  { name: 'DATA_DIR', label: 'Data directory (relative to installation or absolute)', default: './data' },
  { name: 'INTERNAL_LLM_SOURCE', label: 'Models for memory and Knowledge', default: 'external', choices: ['cliproxy', 'external'] },
  { name: 'LLM_BASE_URL', label: 'API base URL', placeholder: 'https://api.example.com/v1' },
  { name: 'LLM_API_KEY', label: 'API key', secret: true },
  { name: 'MEMORY_LLM_MODEL', label: 'Core memory model' },
  { name: 'KNOWLEDGE_LLM_MODEL', label: 'Knowledge model' },
  { name: 'CORE_API_KEY', label: 'Core service key (required for service-to-Core authentication)', secret: true, role: 'core' },
  { name: 'CLIPROXY_API_KEY', label: 'CLIProxyAPI service key', secret: true, role: 'cliproxy' },
  { name: 'CLIPROXY_AUTH_PROVIDER', label: 'CLIProxyAPI account provider', default: 'codex', choices: Object.keys(accountProviders) },
  { name: 'MEMORY_PROMPT_MODE', label: 'Memory prompt mode', default: 'code', choices: ['code', 'chat'] },
  { name: 'LOG_LEVEL', label: 'Log level', default: 'error', choices: ['error', 'warn', 'info', 'debug'] },
  // Core limits follow upstream deploy/global-images/start-memory-core.sh defaults.
  { name: 'MEMORY_LLM_MAX_TOKENS', label: 'Core maximum output tokens', default: '32000' },
  { name: 'KNOWLEDGE_LLM_MAX_TOKENS', label: 'Knowledge maximum output tokens', default: '32768' },
  { name: 'MEMORY_LLM_TIMEOUT_MS', label: 'Core LLM timeout (milliseconds)', default: '300000' },
  { name: 'KNOWLEDGE_LLM_TIMEOUT_MS', label: 'Knowledge LLM timeout (milliseconds)', default: '1200000' },
];
export const defaults = Object.fromEntries(fields.filter(f => f.default !== undefined).map(f => [f.name, f.default! ]));
export function generateKey(role: 'admin' | 'core' | 'cliproxy'): string {
  return `sk-ams-${role}-${randomBytes(32).toString('hex')}`;
}
/** Settings whose values belong to the operator's native TDAI documents. */
export function isNativeSetting(name: string): boolean {
  return /^(CORE_API_KEY|LLM_BASE_URL|LLM_API_KEY|MEMORY_LLM_.*|KNOWLEDGE_LLM_.*|MEMORY_PROMPT_MODE|MEMORY_PROXY_PUBLIC_URL|KNOWLEDGE_PUBLIC_URL)$/.test(name);
}
/** Fill AMS defaults without interpreting or changing supplied values. */
export function resolveSettings(input: Record<string, string>): Record<string, string> {
  const env = { ...Object.fromEntries(Object.entries(defaults).filter(([name]) => !isNativeSetting(name))), ...input };
  if (input.PANEL_PUBLIC_URL === undefined) env.PANEL_PUBLIC_URL = `http://127.0.0.1:${env.PANEL_PORT}`;
  return env;
}
export function reviewSettings(env: Record<string, string>): string {
  const consumed = resolveDeployment(env).fields;
  const local = usesLocalInternalModels(env);
  const lines = fields.filter(f => consumed.includes(f.name)).map(f => `${f.name}: ${f.secret ? '[set]' : env[f.name] ?? ''}`);
  if (local) lines.push(`Effective internal API base URL: ${internalLLM(env).baseURL}`, 'Effective internal API key: CLIPROXY_API_KEY [set]');
  return lines.join('\n');
}
