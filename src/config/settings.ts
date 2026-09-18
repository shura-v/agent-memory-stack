import { DeploymentError } from "../runtime/errors.js";
import { randomBytes } from 'node:crypto';
import { resolveDeployment, selectionFromEnv } from '../deployment/model.js';
import { accountProviders } from './providers.js';

export type Field = { name: string; label: string; default?: string; placeholder?: string; secret?: boolean; role?: 'core' | 'cliproxy'; choices?: string[] };
export const fields: Field[] = [
  { name: 'AMS_DEPLOYMENT_VERSION', label: 'Deployment schema version', default: '1' },
  { name: 'AMS_SERVICES', label: 'Services on this machine', default: 'core,knowledge,panel,memory-proxy,cli-proxy-api,mcp' },
  ...['CORE', 'MODEL', 'KNOWLEDGE', 'PANEL', 'PROXY'].map(prefix => ({ name: `${prefix}_MODE`, label: `${prefix} dependency mode`, choices: ['local', 'remote', 'disabled'] })),
  { name: 'REMOTE_CORE_URL', label: 'Remote Core service base URL (reachable from containers)' },
  { name: 'REMOTE_CORE_API_KEY', label: 'Existing remote Core service key (use the key from the machine running Core)', secret: true },
  { name: 'REMOTE_MODEL_BASE_URL', label: 'Remote model API base URL (including its API prefix)' },
  { name: 'REMOTE_MODEL_API_KEY', label: 'Existing remote model API key', secret: true },
  { name: 'REMOTE_KNOWLEDGE_URL', label: 'Remote authenticated Knowledge service base URL' },
  { name: 'REMOTE_KNOWLEDGE_TOOLS_URL', label: 'Remote protected Knowledge tools base URL' },
  { name: 'REMOTE_PANEL_URL', label: 'Remote Panel callback base URL (reachable from containers)' },
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
export function origin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || /(?:^|\.)example\.(?:com|net|org)$/i.test(url.hostname)) throw new DeploymentError('Enter an HTTP(S) origin without an API path');
  return url.origin;
}
export function apiBase(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || /\/(?:responses|chat\/completions)\/?$/.test(url.pathname)
    || /(?:^|\.)example\.(?:com|net|org)$/i.test(url.hostname)) throw new DeploymentError('Enter an HTTP(S) service API base');
  return value.replace(/\/+$/, '');
}
export function validateField(field: Field, value: string): string | undefined {
  if (!value.trim() || /[\x00-\x1f\x7f]/.test(value) || /^(?:your[-_ ]|replace|changeme|<)/i.test(value)) return `Set ${field.name}`;
  if (field.name.endsWith('_PUBLIC_URL')) { try { origin(value); } catch { return `Set a valid HTTP(S) origin for ${field.name}`; } }
  if (field.name === 'LLM_BASE_URL' || /^REMOTE_.*_URL$/.test(field.name)) {
    try { apiBase(value); } catch { return `Set an HTTP(S) API base in ${field.name}`; }
  }
  if (field.name.endsWith('_PORT') && (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)) return `Set ${field.name} to 1024–65535`;
  if (/_MAX_TOKENS$|_TIMEOUT_MS$/.test(field.name) && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) return `Set a positive integer for ${field.name}`;
  if (field.choices && !field.choices.includes(value)) return `Choose ${field.name} from the listed values`;
  if (field.name === 'DATA_DIR' && /[$:]/.test(value)) return 'DATA_DIR must not contain $ or :';
  if (field.secret && value.trim() !== value) return `Remove surrounding whitespace from ${field.name}`;
  return undefined;
}
export function validateEnv(input: Record<string, string>): Record<string, string> {
  const selected = selectionFromEnv(input);
  const env = { ...defaults, ...input };
  env.AMS_SERVICES = selected.join(',');
  for (const [prefix, port] of [['MEMORY_PROXY', '8096'], ['KNOWLEDGE', '8422'], ['PANEL', '8123']]) {
    if (input[`${prefix}_PUBLIC_URL`] === undefined) env[`${prefix}_PUBLIC_URL`] = `http://127.0.0.1:${env[`${prefix}_PORT`] ?? port}`;
  }
  const deployment = resolveDeployment(env, { requireConnections: false });
  const consumed = fields.filter(field => deployment.fields.includes(field.name));
  const errors = consumed.filter(f => validateField(f, env[f.name] ?? '')).map(f => f.name);
  if (selected.includes('core') && selected.includes('cli-proxy-api') && env.CORE_API_KEY === env.CLIPROXY_API_KEY) errors.push('CLIPROXY_API_KEY');
  if (Object.keys(input).some(k => !fields.some(f => f.name === k))) errors.push('unknown settings (use the current template)');
  if (deployment.connections.knowledge.mode === 'remote' && env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true' && !input.KNOWLEDGE_PUBLIC_URL) errors.push('KNOWLEDGE_PUBLIC_URL (explicit remote origin required)');
  if (deployment.connections.proxy.mode === 'remote' && !input.MEMORY_PROXY_PUBLIC_URL) errors.push('MEMORY_PROXY_PUBLIC_URL (explicit remote origin required)');
  if (errors.length) throw new DeploymentError(`Set valid values in .env: ${[...new Set(errors)].join(', ')}`);
  for (const f of consumed.filter(f => f.name.endsWith('_PUBLIC_URL'))) env[f.name] = origin(env[f.name]);
  for (const f of consumed.filter(f => f.name === 'LLM_BASE_URL' || /^REMOTE_.*_URL$/.test(f.name))) env[f.name] = apiBase(env[f.name]);
  for (const [name, connection] of Object.entries(deployment.connections).filter(([name]) => name !== 'knowledgeTools')) env[`${name.toUpperCase()}_MODE`] = connection.mode;
  return env;
}
export function reviewSettings(env: Record<string, string>): string {
  const consumed = resolveDeployment(env, { requireConnections: false }).fields;
  return fields.filter(f => consumed.includes(f.name)).map(f => `${f.name}: ${f.secret ? '[set]' : env[f.name]}`).join('\n');
}
