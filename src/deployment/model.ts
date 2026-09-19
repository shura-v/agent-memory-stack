import { internalModelSource } from '../config/internal-llm.js';
export const serviceNames = ['core', 'knowledge', 'panel', 'memory-proxy', 'cli-proxy-api', 'mcp'] as const;
export type Service = typeof serviceNames[number];
export type Helper = 'config' | 'bootstrap' | 'access';
export const catalog: { value: Service; label: string; description: string }[] = [
  { value: 'core', label: 'Core', description: 'memory storage, users, and permissions' },
  { value: 'knowledge', label: 'Knowledge', description: 'Wiki and document processing' },
  { value: 'panel', label: 'Panel', description: 'web interface for managing the stack' },
  { value: 'memory-proxy', label: 'MemoryProxy', description: 'adds memory context to agent requests' },
  { value: 'mcp', label: 'MCP', description: 'Knowledge tools over Streamable HTTP' },
  { value: 'cli-proxy-api', label: 'CLIProxyAPI', description: 'connects your AI accounts and subscriptions to the stack' },
];
export type Connection = { endpoint?: string; key?: string; origin?: string };
export type ServiceInterface = { service: Service | 'access'; field: string; port: number; target: number; audience: 'user' | 'service' };
export type Deployment = {
  services: Service[]; helpers: Helper[]; containers: string[]; requiredImages: (Service | 'runtime')[]; dataDirectories: string[];
  fields: string[]; connections: Record<'core' | 'model' | 'knowledge' | 'panel' | 'proxy' | 'knowledgeTools', Connection>;
  interfaces: ServiceInterface[]; readiness: { service: string; dependsOn: string[] }[];
};

/** The full stack runs together; optional host listeners do not change placement. */
export function resolveDeployment(env: Record<string, string>): Deployment {
  const services = [...serviceNames];
  const localInternalModels = internalModelSource(env) === 'cliproxy';
  const fields = new Set<string>([
    'DATA_DIR', 'LOG_LEVEL', 'INTERNAL_LLM_SOURCE', 'CORE_API_KEY', 'MEMORY_LLM_MODEL',
    'MEMORY_LLM_MAX_TOKENS', 'MEMORY_LLM_TIMEOUT_MS', 'MEMORY_PROMPT_MODE',
    'KNOWLEDGE_LLM_MODEL', 'KNOWLEDGE_LLM_MAX_TOKENS', 'KNOWLEDGE_LLM_TIMEOUT_MS',
    'KNOWLEDGE_PUBLIC_URL', 'KNOWLEDGE_PORT', 'KNOWLEDGE_TOOLS_PUBLIC_ENABLED',
    'PANEL_PORT', 'PANEL_PUBLIC_URL', 'MEMORY_PROXY_PORT', 'MEMORY_PROXY_PUBLIC_URL',
    'CLIPROXY_API_KEY', 'CLIPROXY_AUTH_PROVIDER',
  ]);
  if (!localInternalModels) for (const field of ['LLM_BASE_URL', 'LLM_API_KEY']) fields.add(field);
  const core = { endpoint: 'http://core:8420', key: env.CORE_API_KEY };
  const connections = {
    core,
    model: { endpoint: 'http://cli-proxy-api:8317/v1', key: env.CLIPROXY_API_KEY },
    knowledge: { endpoint: 'http://knowledge:8421', key: core.key, origin: env.KNOWLEDGE_PUBLIC_URL },
    panel: { endpoint: 'http://panel:8123', key: core.key, origin: env.PANEL_PUBLIC_URL },
    proxy: { origin: env.MEMORY_PROXY_PUBLIC_URL },
    knowledgeTools: { endpoint: 'http://access:8080', key: core.key },
  };
  const interfaces: ServiceInterface[] = [];
  const publish = (service: ServiceInterface['service'], field: string, defaultPort: number, target: number, audience: ServiceInterface['audience']) => {
    fields.add(field); interfaces.push({ service, field, port: Number(env[field] ?? defaultPort), target, audience });
  };
  publish('memory-proxy', 'MEMORY_PROXY_PORT', 8096, 8096, 'user');
  if (env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true') publish('access', 'KNOWLEDGE_PORT', 8422, 8080, 'user');
  publish('panel', 'PANEL_PORT', 8123, 8123, 'user');
  publish('mcp', 'MCP_PORT', 8425, 8425, 'user');
  for (const [service, prefix, defaultPort, target] of [
    ['core', 'CORE', 8420, 8420], ['cli-proxy-api', 'CLIPROXY', 8317, 8317], ['knowledge', 'KNOWLEDGE', 8423, 8421],
  ] as const) {
    const enabled = env[`${prefix}_SERVICE_ENABLED`] ?? 'false';
    fields.add(`${prefix}_SERVICE_ENABLED`);
    if (enabled === 'true') publish(service, `${prefix}_SERVICE_PORT`, defaultPort, target, 'service');
  }
  const helpers: Helper[] = ['config', 'bootstrap', 'access'];
  const readiness = services.map(service => ({ service, dependsOn: service === 'core' || service === 'cli-proxy-api' ? [] : ['bootstrap'] }));
  if (localInternalModels) for (const edge of readiness) if (edge.service === 'core' || edge.service === 'knowledge') edge.dependsOn.push('cli-proxy-api');
  readiness.find(edge => edge.service === 'memory-proxy')!.dependsOn.push('cli-proxy-api');
  readiness.find(edge => edge.service === 'mcp')!.dependsOn.push('access');
  return { services, helpers, containers: [...services, ...helpers], requiredImages: [...services, 'runtime'], dataDirectories: services.filter(service => service !== 'mcp').map(service => service === 'memory-proxy' ? 'proxy' : service), fields: [...fields], connections, interfaces, readiness };
}
