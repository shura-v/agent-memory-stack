import { resolveDeployment } from '../deployment/model.js';
const serviceId = 'ams';

export function serviceConfigs(env: Record<string, string>) {
  const deployment = resolveDeployment(env);
  const { core: coreConnection, model, knowledge, panel: panelConnection, proxy: proxyConnection } = deployment.connections;
  const coreUrl = coreConnection.endpoint;
  const coreKey = coreConnection.key;
  const knowledgeUrl = knowledge.endpoint;
  const knowledgeEnabled = knowledge.mode !== 'disabled';
  const knowledgeHttpEnabled = knowledgeEnabled && env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true';
  const publicProxy = proxyConnection.mode !== 'disabled' ? env.MEMORY_PROXY_PUBLIC_URL : '';
  const publicKnowledge = knowledgeHttpEnabled ? `${env.KNOWLEDGE_PUBLIC_URL}/v3` : '';
  const credentials = { CORE_URL: coreUrl, CORE_API_KEY: coreKey, TDAI_SERVICE_ID: serviceId, SERVICE_ID: serviceId };
  const core = {
    deployMode: 'standalone', instanceId: serviceId,
    server: { host: '0.0.0.0', port: 8420 }, data: { baseDir: '/data/memory' },
    memory: {
      promptMode: env.MEMORY_PROMPT_MODE, storeBackend: 'sqlite',
      capture: { enabled: true }, extraction: { enabled: true, enableDedup: true, maxMemoriesPerSession: 20 },
      persona: { triggerEveryN: 50, maxScenes: 15 },
      pipeline: { everyNConversations: 5, enableWarmup: true, l1IdleTimeoutSeconds: 600, l2DelayAfterL1Seconds: 90, l2MinIntervalSeconds: 900, l2MaxIntervalSeconds: 3600 },
      recall: { enabled: true, maxResults: 5, scoreThreshold: 0.3, strategy: 'hybrid', timeoutMs: 5000 },
      embedding: { enabled: false, provider: 'none' },
    },
    skill: { enabled: true, routing: { mode: 'bm25', searchTopK: 20 }, extraction: { enabled: true, maxIterations: 16, queue: { backend: 'local' } } },
  };
  const proxy = {
    server: { host: '0.0.0.0', port: 8096, forwardTimeoutMs: 600000 },
    upstream: { url: model.endpoint, apiKey: model.key },
    log: { level: env.LOG_LEVEL, verbose: false },
    auth: { enabled: true, url: coreUrl, timeoutMs: 10000 },
    redis: { enabled: false }, rateLimit: { qpm: 0, tpm: 0 },
    storage: { enabled: true, backend: 'sqlite', sqlite: { dbPath: '/data/proxy.db' } },
    creditReport: { url: '' }, creditPricing: { models: [] },
    opik: { enabled: false }, langfuse: { enabled: false }, clickhouse: { enabled: false }, traceArchive: { enabled: false },
    injection: { enabled: true, injectors: knowledgeEnabled ? ['skill', 'knowledge', 'tdai-memory'] : ['skill', 'tdai-memory'], externalGatewayUrl: publicProxy, assetReflection: { markerOptIn: false } },
    extraction: { enabled: true, extractors: ['skill', 'tdai-memory'] },
    sessionInit: { enabled: true, skipAssetConfirm: true, headerAutoSelect: { enabled: true, teamHeader: 'x-team-id', agentHeader: 'x-agent-id', taskHeader: 'x-task-id', onMismatch: 'form' } },
    tdai: { enabled: true, endpoint: coreUrl, apiKey: coreKey, serviceId, memory: { enabled: true, inject: true, writeL0: true, recallL1: true, injectL2L3: true, timeoutMs: 10000 } },
    skill: { endpoint: coreUrl, serviceToken: coreKey, serviceId, timeoutMs: 10000 },
    knowledge: { enabled: knowledgeEnabled, endpoint: coreUrl, serviceToken: coreKey, serviceId, timeoutMs: 10000 },
    skillRuntime: { allowLlmWrite: false },
  };
  const configs = {
    'core.yaml': core,
    'core-env.json': {
      TDAI_GATEWAY_CONFIG: '/config/core.yaml', TDAI_GATEWAY_HOST: '0.0.0.0', TDAI_GATEWAY_PORT: '8420',
      TDAI_GATEWAY_API_KEY: env.CORE_API_KEY, TDAI_INSTANCE_ID: serviceId, TDAI_DEPLOY_MODE: 'standalone',
      AMS_CORE_API_KEY: env.CORE_API_KEY,
      AMS_IDENTITY_FILE: '/data/ams-identity.json',
      TDAI_DATA_DIR: '/data/memory', TDAI_METADATA_SQLITE_BASE_DIR: '/data/metadata', STORE_MODE: 'sqlite',
      TDAI_LLM_PROVIDER: 'openai', TDAI_LLM_BASE_URL: env.LLM_BASE_URL,
      TDAI_LLM_API_KEY: env.LLM_API_KEY, TDAI_LLM_MODEL: env.MEMORY_LLM_MODEL,
      TDAI_LLM_MAX_TOKENS: env.MEMORY_LLM_MAX_TOKENS, TDAI_LLM_TIMEOUT_MS: env.MEMORY_LLM_TIMEOUT_MS,
      LOG_LEVEL: env.LOG_LEVEL,
    },
    'knowledge-env.json': {
      PORT: '8421', API_PREFIX: '/v3', LOG_LEVEL: env.LOG_LEVEL,
      KNOWLEDGE_DATA_DIR: '/data', KNOWLEDGE_DB_PATH: '/data/knowledge.db',
      KNOWLEDGE_PUBLIC_BASE_URL: publicKnowledge, TMC_CALLBACK_URL: panelConnection.endpoint,
      AMS_CORE_URL: coreUrl, AMS_CORE_API_KEY: coreKey, AMS_IDENTITY_FILE: '/data/ams-identity.json',
      AMS_KNOWLEDGE_SERVICE_URL: 'http://knowledge-service:8423',
      LLM_MODE: 'custom', LLM_PROTOCOL: 'openai', LLM_PROVIDER: 'custom',
      LLM_BASE_URL: env.LLM_BASE_URL, LLM_API_KEY: env.LLM_API_KEY, LLM_MODEL: env.KNOWLEDGE_LLM_MODEL,
      LLM_MAX_TOKENS: env.KNOWLEDGE_LLM_MAX_TOKENS, LLM_TIMEOUT_MS: env.KNOWLEDGE_LLM_TIMEOUT_MS,
      KNOWLEDGE_CLICKHOUSE_ENABLED: 'false', KNOWLEDGE_AUTO_SYNC_ENABLED: 'false',
    },
    'panel-env.json': {
      HOST: '0.0.0.0', PORT: '8123', LOG_LEVEL: env.LOG_LEVEL, LOG_FORMAT: 'json',
      METADATA_INSTANCES_CONFIG: '/config/panel-instances.json',
      KNOWLEDGE_SERVICE_URL: knowledgeUrl, KNOWLEDGE_LLM_BINDING_SYNC: 'false', PANEL_AUTH_MODE: 'user_key',
      KNOWLEDGE_AUTH_TOKEN: knowledgeEnabled ? coreKey : '',
      AMS_CORE_URL: coreUrl, AMS_CORE_API_KEY: coreKey, AMS_KNOWLEDGE_SERVICE_URL: knowledgeUrl ?? '',
      AMS_KNOWLEDGE_ENABLED: String(knowledgeEnabled), AMS_IDENTITY_FILE: '/data/ams-identity.json',
      TDAI_AGENT_TEMPLATE_DIR: '/data/templates', PANEL_CLICKHOUSE_ENABLED: 'false', PANEL_FEATURE_ANALYTICS_ENABLED: 'false',
    },
    'panel-instances.json': { instances: [{ id: serviceId, name: 'Agent Memory Stack', gateway_endpoint: coreUrl, api_key: coreKey, ...(publicProxy ? { proxy_endpoint: publicProxy } : {}) }] },
    'proxy.yaml': proxy,
    'proxy-env.json': { ...credentials, AMS_KNOWLEDGE_ENABLED: String(knowledgeEnabled), AMS_KNOWLEDGE_HTTP_ENABLED: String(knowledgeHttpEnabled), AMS_KNOWLEDGE_URL: knowledgeHttpEnabled ? env.KNOWLEDGE_PUBLIC_URL : '', AMS_PROXY_URL: publicProxy, PROXY_DB_PATH: '/data/proxy.db' },
    'bootstrap-env.json': { ...credentials },
    'access-env.json': { ...credentials, KNOWLEDGE_URL: knowledgeUrl, ACCESS_PORT: '8080' },
    'knowledge-service.json': { port: 8423, knowledgeUrl: 'http://knowledge:8421', coreUrl, coreApiKey: coreKey, serviceId, panelUrl: panelConnection.endpoint, identityFile: '/data/ams-identity.json' },
    'cli-proxy-api.yaml': {
      host: '0.0.0.0', port: 8317, 'auth-dir': '/data/auth', 'api-keys': [env.CLIPROXY_API_KEY],
      'remote-management': { 'allow-remote': false, 'secret-key': '', 'disable-control-panel': true },
      debug: false, 'logging-to-file': false, 'usage-statistics-enabled': false, 'proxy-url': '',
      'request-retry': 1, 'ws-auth': true,
    },
  };
  const files: Record<string, string[]> = {
    core: ['core.yaml', 'core-env.json', 'bootstrap-env.json'],
    knowledge: ['knowledge-env.json', 'access-env.json', 'knowledge-service.json'],
    panel: ['panel-env.json', 'panel-instances.json'],
    'memory-proxy': ['proxy.yaml', 'proxy-env.json'],
    'cli-proxy-api': ['cli-proxy-api.yaml'],
  };
  const selectedFiles = new Set(deployment.services.flatMap(service => files[service]));
  return Object.fromEntries(Object.entries(configs).filter(([name]) => selectedFiles.has(name))) as Partial<typeof configs>;
}
