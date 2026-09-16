import { resolveDeployment } from '../deployment/model.js';
import type { Service } from '../deployment/model.js';
import { stringify } from 'yaml';

type ServiceDefinition = Record<string, unknown>;
export const imageVariables = { core: 'CORE_IMAGE', knowledge: 'KNOWLEDGE_IMAGE', panel: 'PANEL_IMAGE', 'memory-proxy': 'PROXY_IMAGE', 'cli-proxy-api': 'CLIPROXY_IMAGE', runtime: 'RUNTIME_IMAGE' } as const;
const ports: Partial<Record<Service, number>> = { core: 8420, knowledge: 8421, panel: 8123, 'memory-proxy': 8096 };
const common = () => ({ restart: 'unless-stopped', networks: ['stack'], security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'], logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } } });
const health = (port: number) => ({ interval: '10s', timeout: '5s', retries: 12, start_period: '30s', test: ['CMD', 'node', '-e', `fetch('http://127.0.0.1:${port}/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`] });
const image = (service: keyof typeof imageVariables) => '${' + imageVariables[service] + '}';
const data = (directory: string) => '${DATA_DIR}/' + directory + ':/data';

/** Keep human-readable Compose output without anchors or aliases. */
export function composeDocument(settings: Record<string, string>): { services: Record<string, ServiceDefinition>; networks: Record<string, unknown> } {
  const plan = resolveDeployment(settings);
  const services: Record<string, ServiceDefinition> = {};
  services.config = { image: image('runtime'), user: '0:0', command: ['runtime/config.js', 'generate', '/state'], environment: { AMS_DATA_ROOT: '/data', AMS_SERVICE_UID: '10001' }, volumes: ['./:/state', '${DATA_DIR}:/data'], network_mode: 'none', restart: 'no' };
  for (const name of plan.services) {
    const item: ServiceDefinition = { ...common(), image: image(name), volumes: ['./generated:/config:ro', data(name === 'memory-proxy' ? 'proxy' : name)] };
    if (ports[name]) item.healthcheck = health(ports[name]!);
    services[name] = item;
  }
  if (plan.helpers.includes('bootstrap')) services.bootstrap = { image: image('runtime'), user: '0:0', command: ['--import', '/app/runtime/environment.js', 'runtime/bootstrap.js', 'check'], environment: { AMS_ENV_FILE: '/config/bootstrap-env.json' }, volumes: ['./generated:/config:ro'], networks: ['stack'], restart: 'no' };
  if (plan.helpers.includes('access')) services.access = { ...common(), image: image('runtime'), command: ['--import', '/app/runtime/environment.js', 'runtime/access-gateway.js'], environment: { AMS_ENV_FILE: '/config/access-env.json' }, volumes: ['./generated:/config:ro'], healthcheck: health(8080) };
  if (plan.helpers.includes('knowledge-service')) services['knowledge-service'] = { ...common(), image: image('runtime'), command: ['runtime/knowledge-service.js', '/config/knowledge-service.json'], volumes: ['./generated:/config:ro', data('knowledge')], healthcheck: health(8423) };
  for (const name of Object.keys(services)) {
    if (name === 'config') continue;
    const dependencies: Record<string, { condition: string }> = { config: { condition: 'service_completed_successfully' } };
    for (const dependency of plan.readiness.find(edge => edge.service === name)?.dependsOn ?? []) {
      if (services[dependency]) dependencies[dependency] = { condition: dependency === 'bootstrap' ? 'service_completed_successfully' : dependency === 'cli-proxy-api' ? 'service_started' : 'service_healthy' };
    }
    if (name === 'bootstrap') dependencies.core = { condition: 'service_healthy' };
    if (name === 'access' || name === 'knowledge-service') dependencies.knowledge = { condition: 'service_healthy' };
    services[name].depends_on = dependencies;
  }
  for (const binding of plan.interfaces) {
    if (!services[binding.service]) throw new Error(`Cannot publish absent service: ${binding.service}`);
    const bindings = services[binding.service].ports as string[] | undefined;
    services[binding.service].ports = [...(bindings ?? []), `127.0.0.1:${binding.port}:${binding.target}`];
  }
  return { services, networks: { stack: {} } };
}
export function renderCompose(settings: Record<string, string>): string { return stringify(composeDocument(settings), { schema: 'core', compat: 'yaml-1.1', aliasDuplicateObjects: false, lineWidth: 0, indent: 2 }); }
