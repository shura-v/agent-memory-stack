import { resolveDeployment } from '../deployment/model.js';
import type { Service } from '../deployment/model.js';
import { stringify } from 'yaml';

type ServiceDefinition = Record<string, unknown>;
export const imageVariables = { core: 'CORE_IMAGE', knowledge: 'KNOWLEDGE_IMAGE', panel: 'PANEL_IMAGE', 'memory-proxy': 'PROXY_IMAGE', 'cli-proxy-api': 'CLIPROXY_IMAGE', mcp: 'MCP_IMAGE', runtime: 'RUNTIME_IMAGE' } as const;
const ports: Partial<Record<Service, number>> = { core: 8420, knowledge: 8421, panel: 8123, 'memory-proxy': 8096, mcp: 8425 };
const common = () => ({ restart: 'unless-stopped', networks: ['stack'], security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'], logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } } });
const health = (port: number) => ({ interval: '10s', timeout: '5s', retries: 12, start_period: '30s', test: ['CMD', 'node', '-e', `fetch('http://127.0.0.1:${port}/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`] });
const image = (service: keyof typeof imageVariables) => '${' + imageVariables[service] + '}';
const data = (directory: string) => '${DATA_DIR}/' + directory + ':/data';

/** Keep human-readable Compose output without anchors or aliases. */
export function composeDocument(settings: Record<string, string>, native?: { generation: string; root: string }): { services: Record<string, ServiceDefinition>; networks: Record<string, unknown> } {
  const plan = resolveDeployment(settings);
  if (native && !/^[a-f0-9-]{36}$/.test(native.generation)) throw new Error('Invalid native generation');
  const configDirectory = native ? `./.ams/generations/${native.generation}` : './generated';
  const files: Record<string, string[]> = {
    core: ['core.yaml'], knowledge: ['knowledge.env'],
    panel: ['panel.env', 'panel-instances.json'], 'memory-proxy': ['proxy.yaml'],
    mcp: ['mcp.json'], 'cli-proxy-api': ['cli-proxy-api.yaml'], bootstrap: ['bootstrap-env.json'],
    access: ['access-env.json'],
  };
  const mounts = (service: string) => files[service].map(name => `${configDirectory}/${name}:${name === 'knowledge.env' || name === 'panel.env' ? '/app/.env' : `/config/${name}`}:ro`);
  const services: Record<string, ServiceDefinition> = {};
  services.config = { image: image('runtime'), user: '0:0', command: ['runtime/config.js', 'generate', '/state'], environment: { AMS_DATA_ROOT: '/data', AMS_SERVICE_UID: '10001' }, volumes: ['./:/state', '${DATA_DIR}:/data'], network_mode: 'none', restart: 'no' };
  for (const name of plan.services) {
    const item: ServiceDefinition = { ...common(), image: image(name), volumes: [...mounts(name), data(name === 'memory-proxy' ? 'proxy' : name)] };
    if (name === 'mcp') item.volumes = mounts(name);
    if (name === 'core') item.environment = { TDAI_GATEWAY_CONFIG: '/config/core.yaml' };
    if (native) item.labels = { 'io.agent-memory-stack.native-config': native.root };
    if (ports[name]) item.healthcheck = health(ports[name]!);
    services[name] = item;
  }
  services.bootstrap = { image: image('runtime'), user: '0:0', command: ['--import', '/app/runtime/environment.js', 'runtime/bootstrap.js', 'check'], environment: { AMS_ENV_FILE: '/config/bootstrap-env.json' }, volumes: mounts('bootstrap'), networks: ['stack'], restart: 'no' };
  services.access = { ...common(), image: image('runtime'), command: ['--import', '/app/runtime/environment.js', 'runtime/access-gateway.js'], environment: { AMS_ENV_FILE: '/config/access-env.json' }, volumes: mounts('access'), healthcheck: health(8080) };
  for (const name of Object.keys(services)) {
    if (name === 'config') continue;
    const dependencies: Record<string, { condition: string }> = { config: { condition: 'service_completed_successfully' } };
    for (const dependency of plan.readiness.find(edge => edge.service === name)?.dependsOn ?? []) {
      dependencies[dependency] = { condition: dependency === 'bootstrap' ? 'service_completed_successfully' : dependency === 'cli-proxy-api' ? 'service_started' : 'service_healthy' };
    }
    if (name === 'bootstrap') dependencies.core = { condition: 'service_healthy' };
    if (name === 'access') dependencies.knowledge = { condition: 'service_healthy' };
    services[name].depends_on = dependencies;
  }
  for (const binding of plan.interfaces) {
    const bindings = services[binding.service].ports as string[] | undefined;
    services[binding.service].ports = [...(bindings ?? []), `127.0.0.1:${binding.port}:${binding.target}`];
  }
  return { services, networks: { stack: {} } };
}
export function renderCompose(settings: Record<string, string>, native?: { generation: string; root: string }): string { return stringify(composeDocument(settings, native), { schema: 'core', compat: 'yaml-1.1', aliasDuplicateObjects: false, lineWidth: 0, indent: 2 }); }
