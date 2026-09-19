import { resolveDeployment } from '../deployment/model.js';
const serviceId = 'ams';

/** Configuration shared by authorization startup and the running stack. */
export function cliProxyConfig(env: Record<string, string>) {
  return {
    host: '0.0.0.0', port: 8317, 'auth-dir': '/data/auth', 'api-keys': [env.CLIPROXY_API_KEY],
    'remote-management': { 'allow-remote': false, 'secret-key': '', 'disable-control-panel': true },
    debug: false, 'logging-to-file': false, 'usage-statistics-enabled': false, 'proxy-url': '',
    'request-retry': 1, 'ws-auth': true,
  };
}

/** AMS MCP connections derived independently of native service generation. */
export function mcpConfig(env: Record<string, string>) {
  const { core, knowledgeTools } = resolveDeployment(env).connections;
  return { port: 8425, coreUrl: core.endpoint, coreApiKey: core.key ?? '', knowledgeToolsUrl: knowledgeTools.endpoint, serviceId };
}
