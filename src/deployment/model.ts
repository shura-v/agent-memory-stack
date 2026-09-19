import { DeploymentError } from "../runtime/errors.js";
import { internalModelSource } from '../config/internal-llm.js';
export const serviceNames = ['core', 'knowledge', 'panel', 'memory-proxy', 'cli-proxy-api', 'mcp'] as const;
export type Service = typeof serviceNames[number];
export type Mode = 'local' | 'remote' | 'disabled';
export type Helper = 'config' | 'bootstrap' | 'access' | 'knowledge-service';
export const catalog: { value: Service; label: string; description: string }[] = [
  { value: 'core', label: 'Core', description: 'memory storage, users, and permissions' },
  { value: 'knowledge', label: 'Knowledge', description: 'Wiki and document processing' },
  { value: 'panel', label: 'Panel', description: 'web interface for managing the stack' },
  { value: 'memory-proxy', label: 'MemoryProxy', description: 'adds memory context to agent requests' },
  { value: 'mcp', label: 'MCP', description: 'Knowledge tools over Streamable HTTP' },
  { value: 'cli-proxy-api', label: 'CLIProxyAPI', description: 'connects your AI accounts and subscriptions to the stack' },
];
export type Connection = { mode: Mode; required: boolean; consumers: Service[]; endpoint?: string; key?: string; origin?: string };
export type ServiceInterface = { service: Service | 'access' | 'knowledge-service'; field: string; port: number; target: number; audience: 'user' | 'service' };
export type Deployment = {
  services: Service[]; helpers: Helper[]; containers: string[]; requiredImages: (Service | 'runtime')[]; dataDirectories: string[];
  fields: string[]; connections: Record<'core' | 'model' | 'knowledge' | 'panel' | 'proxy' | 'knowledgeTools', Connection>;
  interfaces: ServiceInterface[]; readiness: { service: string; dependsOn: string[] }[];
};

export function selectionFromEnv(env: Record<string, string>): Service[] {
  const version = env.AMS_DEPLOYMENT_VERSION;
  const value = env.AMS_SERVICES;
  if (version === undefined && value === undefined) return [...serviceNames];
  if (version !== '1' || value === undefined) throw new DeploymentError('Set AMS_DEPLOYMENT_VERSION=1 and AMS_SERVICES to the selected service names');
  const selected = value.split(',').map(name => name.trim());
  if (!value.trim()) throw new DeploymentError('Set AMS_SERVICES in .env to at least one service');
  if (new Set(selected).size !== selected.length || selected.some(name => !serviceNames.includes(name as Service))) throw new DeploymentError('AMS_SERVICES contains unknown or duplicate service names');
  return serviceNames.filter(name => selected.includes(name));
}

/** Resolves placement independently of field validation, so the wizard can plan its questions. */
export function resolveDeployment(env: Record<string, string>, { requireConnections = true }: { requireConnections?: boolean } = {}): Deployment {
  const services = selectionFromEnv(env);
  const has = (service: Service) => services.includes(service);
  const internalSource = internalModelSource(env);
  const localInternalModels = internalSource === 'cliproxy' && (has('core') || has('knowledge'));
  if (localInternalModels && !has('cli-proxy-api')) throw new DeploymentError('INTERNAL_LLM_SOURCE=cliproxy requires cli-proxy-api in AMS_SERVICES for local Core or Knowledge');
  const fields = new Set<string>(['DATA_DIR']);
  const consumers = (names: Service[]) => names.filter(has);
  const connection = (name: string, local: Service, needed: Service[], required: boolean, endpoint?: string, key?: string, origin?: string): Connection => {
    const used = consumers(needed);
    const explicit = env[`${name}_MODE`];
    if (explicit && !['local', 'remote', 'disabled'].includes(explicit)) throw new DeploymentError(`Set ${name}_MODE to local, remote, or disabled`);
    const mode: Mode = has(local) ? 'local' : used.length && required ? 'remote' : used.length && explicit === 'remote' ? 'remote' : 'disabled';
    if (explicit && explicit !== mode) throw new DeploymentError(`${name}_MODE conflicts with AMS_SERVICES or a required dependency`);
    return { mode, required: used.length > 0 && required, consumers: used, ...(endpoint && mode !== 'disabled' ? { endpoint } : {}), ...(key && mode !== 'disabled' ? { key } : {}), ...(origin && mode !== 'disabled' ? { origin } : {}) };
  };
  const core = connection('CORE', 'core', ['knowledge', 'panel', 'memory-proxy', 'mcp'], true,
    has('core') ? 'http://core:8420' : env.REMOTE_CORE_URL, has('core') ? env.CORE_API_KEY : env.REMOTE_CORE_API_KEY);
  const model = connection('MODEL', 'cli-proxy-api', ['memory-proxy'], true,
    has('cli-proxy-api') ? 'http://cli-proxy-api:8317/v1' : env.REMOTE_MODEL_BASE_URL, has('cli-proxy-api') ? env.CLIPROXY_API_KEY : env.REMOTE_MODEL_API_KEY);
  const knowledge = connection('KNOWLEDGE', 'knowledge', ['panel', 'memory-proxy'], false,
    has('knowledge') ? 'http://knowledge-service:8423' : env.REMOTE_KNOWLEDGE_URL, core.key, env.KNOWLEDGE_PUBLIC_URL);
  const panel = connection('PANEL', 'panel', ['knowledge'], true,
    has('panel') ? 'http://panel:8123' : env.REMOTE_PANEL_URL, core.key, env.PANEL_PUBLIC_URL);
  const proxy = connection('PROXY', 'memory-proxy', ['panel'], false, undefined, undefined, env.MEMORY_PROXY_PUBLIC_URL);
  const knowledgeTools: Connection = { mode: has('mcp') ? has('knowledge') ? 'local' : 'remote' : 'disabled', required: has('mcp'), consumers: has('mcp') ? ['mcp'] : [],
    ...(has('mcp') ? { endpoint: has('knowledge') ? 'http://access:8080' : env.REMOTE_KNOWLEDGE_TOOLS_URL, key: core.key } : {}) };
  const connections = { core, model, knowledge, panel, proxy, knowledgeTools };
  if (services.some(name => name !== 'cli-proxy-api')) fields.add('LOG_LEVEL');
  if (has('core') || has('knowledge')) {
    fields.add('INTERNAL_LLM_SOURCE');
    if (!localInternalModels) for (const field of ['LLM_BASE_URL', 'LLM_API_KEY']) fields.add(field);
  }
  if (has('core')) for (const field of ['CORE_API_KEY', 'MEMORY_LLM_MODEL', 'MEMORY_LLM_MAX_TOKENS', 'MEMORY_LLM_TIMEOUT_MS', 'MEMORY_PROMPT_MODE']) fields.add(field);
  if (has('knowledge')) for (const field of ['KNOWLEDGE_LLM_MODEL', 'KNOWLEDGE_LLM_MAX_TOKENS', 'KNOWLEDGE_LLM_TIMEOUT_MS', 'KNOWLEDGE_PUBLIC_URL', 'KNOWLEDGE_PORT']) fields.add(field);
  if (has('panel')) for (const field of ['PANEL_PORT', 'PANEL_PUBLIC_URL']) fields.add(field);
  if (has('memory-proxy')) for (const field of ['MEMORY_PROXY_PORT', 'MEMORY_PROXY_PUBLIC_URL']) fields.add(field);
  if (has('cli-proxy-api')) for (const field of ['CLIPROXY_API_KEY', 'CLIPROXY_AUTH_PROVIDER']) fields.add(field);
  if (core.mode === 'remote') for (const field of ['REMOTE_CORE_URL', 'REMOTE_CORE_API_KEY']) fields.add(field);
  if (knowledgeTools.mode === 'remote') fields.add('REMOTE_KNOWLEDGE_TOOLS_URL');
  if (model.mode === 'remote') for (const field of ['REMOTE_MODEL_BASE_URL', 'REMOTE_MODEL_API_KEY']) fields.add(field);
  if (knowledge.mode === 'remote') {
    if (env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true') fields.add('KNOWLEDGE_PUBLIC_URL');
    if (has('panel')) fields.add('REMOTE_KNOWLEDGE_URL');
  }
  if (panel.mode === 'remote') fields.add('REMOTE_PANEL_URL');
  if (proxy.mode === 'remote') fields.add('MEMORY_PROXY_PUBLIC_URL');
  const interfaces: ServiceInterface[] = [];
  const publish = (service: ServiceInterface['service'], field: string, defaultPort: number, target: number, audience: ServiceInterface['audience']) => {
    fields.add(field); interfaces.push({ service, field, port: Number(env[field] ?? defaultPort), target, audience });
  };
  if (has('memory-proxy')) publish('memory-proxy', 'MEMORY_PROXY_PORT', 8096, 8096, 'user');
  if (knowledge.mode !== 'disabled') fields.add('KNOWLEDGE_TOOLS_PUBLIC_ENABLED');
  if (has('knowledge') && env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true') publish('access', 'KNOWLEDGE_PORT', 8422, 8080, 'user');
  if (has('panel')) publish('panel', 'PANEL_PORT', 8123, 8123, 'user');
  if (has('mcp')) publish('mcp', 'MCP_PORT', 8425, 8425, 'user');
  for (const [service, prefix, defaultPort, target] of [
    ['core', 'CORE', 8420, 8420], ['cli-proxy-api', 'CLIPROXY', 8317, 8317], ['knowledge', 'KNOWLEDGE', 8423, 8423],
  ] as const) {
    const enabled = env[`${prefix}_SERVICE_ENABLED`] ?? 'false';
    if (has(service)) {
      if (!['true', 'false'].includes(enabled)) throw new DeploymentError(`Set ${prefix}_SERVICE_ENABLED to true or false`);
      fields.add(`${prefix}_SERVICE_ENABLED`);
      if (enabled === 'true') publish(service === 'knowledge' ? 'knowledge-service' : service, `${prefix}_SERVICE_PORT`, defaultPort, target, 'service');
    }
  }
  const helpers: Helper[] = ['config'];
  if (has('core')) helpers.push('bootstrap');
  if (has('knowledge')) helpers.push('access', 'knowledge-service');
  const containers = [...services, ...helpers];
  const readiness = services.map(service => ({ service, dependsOn: service === 'core' || service === 'cli-proxy-api' ? [] : has('core') ? ['bootstrap'] : [] }));
  if (localInternalModels) for (const edge of readiness) if (edge.service === 'core' || edge.service === 'knowledge') edge.dependsOn.push('cli-proxy-api');
  if (has('memory-proxy') && has('cli-proxy-api')) readiness.find(edge => edge.service === 'memory-proxy')!.dependsOn.push('cli-proxy-api');
  if (has('mcp') && has('knowledge')) readiness.find(edge => edge.service === 'mcp')!.dependsOn.push('access');
  if (requireConnections) {
    for (const field of fields) if (/^REMOTE_/.test(field) && !env[field]?.trim()) throw new DeploymentError(`Set ${field} in .env for the configured remote dependency`);
    if (knowledge.mode === 'remote' && env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true' && !env.KNOWLEDGE_PUBLIC_URL?.trim()) throw new DeploymentError('Configure KNOWLEDGE_PUBLIC_URL for remote Knowledge tools');
    if (proxy.mode === 'remote' && !env.MEMORY_PROXY_PUBLIC_URL?.trim()) throw new DeploymentError('Configure MEMORY_PROXY_PUBLIC_URL for remote agent guidance');
  }
  return { services, helpers, containers, requiredImages: [...services, 'runtime'], dataDirectories: services.filter(service => service !== 'mcp').map(service => service === 'memory-proxy' ? 'proxy' : service), fields: [...fields], connections, interfaces, readiness };
}
