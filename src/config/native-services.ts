import { randomBytes } from 'node:crypto';
import { resolveDeployment } from '../deployment/model.js';
import { DeploymentError } from '../runtime/errors.js';
import { internalLLM } from './internal-llm.js';
import { parseNativeDocument, updateNativeDocument } from './native-documents.js';
import type { NativeValue } from './native-documents.js';
import { nativeFileNames, type NativeFileName } from './native-templates.js';
import { defaults, resolveSettings } from './settings.js';
import { cliProxyConfig, mcpConfig } from './services.js';

export type NativeServiceDocuments = Partial<Record<NativeFileName, string>>;
type Settings = Record<string, string>;
type ObjectValue = Record<string, NativeValue>;
function object(value: NativeValue | undefined): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function read(documents: NativeServiceDocuments, name: NativeFileName): ObjectValue {
  const text = documents[name];
  return text === undefined ? {} : object(parseNativeDocument(text, name.endsWith('.yaml') ? 'yaml' : name.endsWith('.env') ? 'env' : 'json'));
}
function at(value: ObjectValue, path: string): NativeValue | undefined {
  return path.split('.').reduce<NativeValue | undefined>((value, key) => object(value)[key], value);
}
function string(value: NativeValue | undefined): string { return value === undefined || value === null ? '' : String(value); }
function numericValue(value: string): NativeValue {
  const number = Number(value);
  return value.trim() !== '' && Number.isFinite(number) ? number : value;
}
function edits(values: Record<string, NativeValue>) { return Object.entries(values).map(([path, value]) => ({ path: path.split('.'), value })); }

/** Populate known installation values into supplied documents only during initial provisioning. */
export function seedNativeServiceConfigs(input: Settings, templates: NativeServiceDocuments, previous: NativeServiceDocuments = {}): NativeServiceDocuments {
  const env = resolveSettings({ ...defaults, ...input });
  const deployment = resolveDeployment(env);
  const { core, model, knowledge, panel } = deployment.connections;
  const llm = internalLLM(env);
  const publicProxy = env.MEMORY_PROXY_PUBLIC_URL;
  const publicKnowledge = env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED === 'true' ? `${env.KNOWLEDGE_PUBLIC_URL}/v3` : '';
  const result: NativeServiceDocuments = {};
  const set = (name: NativeFileName, values: Record<string, NativeValue>) => {
    const template = templates[name];
    if (template === undefined) throw new DeploymentError(`Missing native template: ${name}`);
    result[name] = updateNativeDocument(template, name.endsWith('.yaml') ? 'yaml' : name.endsWith('.env') ? 'env' : 'json', edits(values));
  };
  set('core.yaml', {
    deployMode: 'standalone', instanceId: 'ams', 'server.host': '0.0.0.0', 'server.port': 8420,
    ...(input.CORE_API_KEY === undefined ? {} : { 'server.apiKey': input.CORE_API_KEY }),
    'observability.langfuse.enabled': false,
    'data.baseDir': '/data/memory', 'metadata.store.sqliteBaseDir': '/data/metadata',
    'llm.provider': 'openai', 'llm.baseUrl': llm.baseURL, 'llm.apiKey': llm.apiKey, 'llm.model': env.MEMORY_LLM_MODEL ?? '',
    ...(input.MEMORY_LLM_MAX_TOKENS === undefined ? {} : { 'llm.maxTokens': numericValue(input.MEMORY_LLM_MAX_TOKENS) }),
    ...(input.MEMORY_LLM_TIMEOUT_MS === undefined ? {} : { 'llm.timeoutMs': numericValue(input.MEMORY_LLM_TIMEOUT_MS) }),
    'memory.promptMode': env.MEMORY_PROMPT_MODE,
  });
  {
    const source = previous['proxy.yaml'] === undefined ? read(templates, 'proxy.yaml') : read(previous, 'proxy.yaml');
    let adminKey = string(at(source, 'admin.apiKey'));
    adminKey ||= `sk-ams-proxy-admin-${randomBytes(32).toString('hex')}`;
    set('proxy.yaml', {
      'server.host': '0.0.0.0', 'server.port': 8096, 'upstream.url': model.endpoint ?? '', 'upstream.apiKey': model.key ?? '',
      'admin.apiKey': adminKey, 'log.level': env.LOG_LEVEL, 'log.file': '',
      'auth.enabled': true, 'auth.url': core.endpoint ?? '', 'redis.enabled': false, 'rateLimit.qpm': 0, 'rateLimit.tpm': 0,
      'storage.enabled': true, 'storage.backend': 'sqlite', 'storage.sqlite.dbPath': '/data/proxy.db',
      'creditReport.url': '', 'creditPricing.models': [], 'opik.enabled': false, 'langfuse.enabled': false, 'clickhouse.enabled': false, 'traceArchive.enabled': false,
      'injection.enabled': true, 'injection.injectors': ['skill', 'knowledge', 'tdai-memory'],
      'injection.externalGatewayUrl': publicProxy, 'injection.assetReflection.markerOptIn': false,
      'extraction.enabled': true, 'extraction.extractors': ['skill', 'tdai-memory'], 'sessionInit.skipAssetConfirm': true,
      'tdai.enabled': true, 'tdai.endpoint': core.endpoint ?? '', 'tdai.serviceId': 'ams',
      'skill.endpoint': core.endpoint ?? '', 'skill.serviceId': 'ams',
      'knowledge.enabled': true, 'knowledge.endpoint': core.endpoint ?? '', 'knowledge.serviceId': 'ams',
      // Stock data-plane clients still require a nonempty Bearer when Core has no shared secret.
      ...(core.key ? { 'tdai.apiKey': core.key, 'skill.serviceToken': core.key, 'knowledge.serviceToken': core.key } : {}),
    });
  }
  set('knowledge.env', {
    PORT: '8421', API_PREFIX: '/v3', LOG_LEVEL: env.LOG_LEVEL, KNOWLEDGE_DATA_DIR: '/data', KNOWLEDGE_DB_PATH: '/data/knowledge.db',
    KNOWLEDGE_PUBLIC_BASE_URL: publicKnowledge, TMC_CALLBACK_URL: panel.endpoint ?? '',
    LLM_MODE: 'custom', LLM_PROTOCOL: 'openai', LLM_PROVIDER: 'custom', LLM_BASE_URL: llm.baseURL, LLM_API_KEY: llm.apiKey,
    LLM_MODEL: env.KNOWLEDGE_LLM_MODEL ?? '',
    ...(input.KNOWLEDGE_LLM_MAX_TOKENS === undefined ? {} : { LLM_MAX_TOKENS: input.KNOWLEDGE_LLM_MAX_TOKENS }),
    ...(input.KNOWLEDGE_LLM_TIMEOUT_MS === undefined ? {} : { LLM_TIMEOUT_MS: input.KNOWLEDGE_LLM_TIMEOUT_MS }),
  });
  set('panel.env', {
    HOST: '0.0.0.0', PORT: '8123', LOG_LEVEL: env.LOG_LEVEL, LOG_FORMAT: 'json', METADATA_INSTANCES_CONFIG: '/config/panel-instances.json',
    KNOWLEDGE_SERVICE_URL: knowledge.endpoint ?? '', KNOWLEDGE_LLM_BINDING_SYNC: 'false',
    ...(core.key ? { KNOWLEDGE_AUTH_TOKEN: core.key } : {}),
    TDAI_AGENT_TEMPLATE_DIR: '/data/templates',
  });
  set('panel-instances.json', { instances: [{ id: 'ams', name: 'Agent Memory Stack', gateway_endpoint: core.endpoint ?? '', api_key: core.key || 'local', ...(publicProxy ? { proxy_endpoint: publicProxy } : {}) }] });
  return result;
}

/** Apply only explicitly reviewed wizard fields to their owning partial overlays. */
export function editNativeServiceOverrides(env: Settings, overrides: NativeServiceDocuments, changes: Settings, onlyMissing = false): void {
  const apply = (name: NativeFileName, path: string, value: NativeValue) => {
    const current = read(overrides, name);
    const old = at(current, path);
    if (onlyMissing && old !== undefined && old !== '') return;
    const format = name.endsWith('.yaml') ? 'yaml' : name.endsWith('.env') ? 'env' : 'json';
    overrides[name] = updateNativeDocument(overrides[name] ?? (format === 'env' ? '' : '{}\n'), format, edits({ [path]: value }));
  };
  const mapping: Record<string, Array<[NativeFileName, string, boolean?]>> = {
    MEMORY_LLM_MODEL: [['core.yaml', 'llm.model']], MEMORY_LLM_MAX_TOKENS: [['core.yaml', 'llm.maxTokens', true]], MEMORY_LLM_TIMEOUT_MS: [['core.yaml', 'llm.timeoutMs', true]], MEMORY_PROMPT_MODE: [['core.yaml', 'memory.promptMode']],
    KNOWLEDGE_LLM_MODEL: [['knowledge.env', 'LLM_MODEL']], KNOWLEDGE_LLM_MAX_TOKENS: [['knowledge.env', 'LLM_MAX_TOKENS']], KNOWLEDGE_LLM_TIMEOUT_MS: [['knowledge.env', 'LLM_TIMEOUT_MS']],
    LLM_BASE_URL: [['core.yaml', 'llm.baseUrl'], ['knowledge.env', 'LLM_BASE_URL']], LLM_API_KEY: [['core.yaml', 'llm.apiKey'], ['knowledge.env', 'LLM_API_KEY']],
    CORE_API_KEY: [['core.yaml', 'server.apiKey']],
    MEMORY_PROXY_PUBLIC_URL: [['proxy.yaml', 'injection.externalGatewayUrl']],
    LOG_LEVEL: [['proxy.yaml', 'log.level'], ['knowledge.env', 'LOG_LEVEL'], ['panel.env', 'LOG_LEVEL']],
  };
  for (const [name, value] of Object.entries(changes)) for (const [file, path, numeric] of mapping[name] ?? []) apply(file, path, numeric ? numericValue(value) : value);
  if ('INTERNAL_LLM_SOURCE' in changes || ('CLIPROXY_API_KEY' in changes && env.INTERNAL_LLM_SOURCE === 'cliproxy')) {
    const llm = internalLLM({ ...env, ...changes });
    apply('core.yaml', 'llm.baseUrl', llm.baseURL); apply('core.yaml', 'llm.apiKey', llm.apiKey);
    apply('knowledge.env', 'LLM_BASE_URL', llm.baseURL); apply('knowledge.env', 'LLM_API_KEY', llm.apiKey);
  }
  const deployment = resolveDeployment({ ...env, ...changes });
  if ('CORE_API_KEY' in changes) {
    const key = deployment.connections.core.key ?? '';
    for (const path of ['tdai.apiKey', 'skill.serviceToken', 'knowledge.serviceToken']) apply('proxy.yaml', path, key);
    apply('panel.env', 'KNOWLEDGE_AUTH_TOKEN', key);
    const instances = read(overrides, 'panel-instances.json').instances;
    if (Array.isArray(instances)) apply('panel-instances.json', 'instances', instances.map(instance => object(instance).id === 'ams' ? { ...object(instance), api_key: key } : instance));
  }
  if ('CLIPROXY_API_KEY' in changes) apply('proxy.yaml', 'upstream.apiKey', deployment.connections.model.key ?? '');
  if ('KNOWLEDGE_PUBLIC_URL' in changes || 'KNOWLEDGE_TOOLS_PUBLIC_ENABLED' in changes) apply('knowledge.env', 'KNOWLEDGE_PUBLIC_BASE_URL', (changes.KNOWLEDGE_TOOLS_PUBLIC_ENABLED ?? env.KNOWLEDGE_TOOLS_PUBLIC_ENABLED) === 'true' ? `${changes.KNOWLEDGE_PUBLIC_URL ?? env.KNOWLEDGE_PUBLIC_URL}/v3` : '');
  if ('MEMORY_PROXY_PUBLIC_URL' in changes) {
    const instances = read(overrides, 'panel-instances.json').instances;
    if (Array.isArray(instances)) {
      const changed = instances.map(instance => object(instance).id === 'ams' && (!onlyMissing || !object(instance).proxy_endpoint) ? { ...object(instance), proxy_endpoint: changes.MEMORY_PROXY_PUBLIC_URL } : instance);
      // Each registry array is an atomic value; fill only its missing endpoint.
      if (JSON.stringify(changed) !== JSON.stringify(instances)) {
        const mode = 'json'; overrides['panel-instances.json'] = updateNativeDocument(overrides['panel-instances.json']!, mode, edits({ instances: changed }));
      }
    }
  }
}

/** Orchestration view only. Native files remain authoritative, including each consumer's overrides. */
export function normalizeNativeServiceConfigs(input: Settings, documents: NativeServiceDocuments): Settings {
  const env = { ...input };
  const core = read(documents, 'core.yaml');
  const proxy = read(documents, 'proxy.yaml');
  const knowledge = read(documents, 'knowledge.env');
  const assign = (name: string, value: NativeValue | undefined) => { if (value !== undefined) env[name] = string(value); else delete env[name]; };
  if (documents['core.yaml'] !== undefined) {
    for (const [name, path] of Object.entries({ CORE_API_KEY: 'server.apiKey', MEMORY_LLM_MODEL: 'llm.model', MEMORY_LLM_MAX_TOKENS: 'llm.maxTokens', MEMORY_LLM_TIMEOUT_MS: 'llm.timeoutMs', MEMORY_PROMPT_MODE: 'memory.promptMode', LLM_BASE_URL: 'llm.baseUrl', LLM_API_KEY: 'llm.apiKey' })) assign(name, at(core, path));
  }
  if (documents['knowledge.env'] !== undefined) for (const [name, field] of Object.entries({ KNOWLEDGE_LLM_MODEL: 'LLM_MODEL', KNOWLEDGE_LLM_MAX_TOKENS: 'LLM_MAX_TOKENS', KNOWLEDGE_LLM_TIMEOUT_MS: 'LLM_TIMEOUT_MS' })) assign(name, knowledge[field]);
  if (documents['proxy.yaml'] !== undefined) assign('MEMORY_PROXY_PUBLIC_URL', at(proxy, 'injection.externalGatewayUrl'));
  if (documents['knowledge.env'] !== undefined) {
    const origin = knowledge.KNOWLEDGE_PUBLIC_BASE_URL;
    assign('KNOWLEDGE_PUBLIC_URL', origin === undefined ? undefined : string(origin).replace(/\/v3\/?$/, ''));
  }
  return env;
}

export function proxyAdminKey(documents: NativeServiceDocuments): string { return string(at(read(documents, 'proxy.yaml'), 'admin.apiKey')); }

/** Only AMS-owned helpers use derived JSON; TDAI consumes its native documents directly. */
export function nativeRuntimeConfigs(input: Settings, documents: NativeServiceDocuments): Record<string, Record<string, unknown>> {
  for (const name of nativeFileNames) {
    if (documents[name] === undefined) throw new DeploymentError(`Missing native configuration: ${name}`);
    read(documents, name);
  }
  const env = normalizeNativeServiceConfigs(input, documents);
  const { core, knowledge } = resolveDeployment(env).connections;
  const credentials = { CORE_URL: core.endpoint ?? '', CORE_API_KEY: core.key ?? '', TDAI_SERVICE_ID: 'ams', SERVICE_ID: 'ams' };
  return {
    'mcp.json': mcpConfig(env),
    'cli-proxy-api.yaml': cliProxyConfig(env),
    'bootstrap-env.json': credentials,
    'access-env.json': { ...credentials, KNOWLEDGE_URL: knowledge.endpoint ?? '', ACCESS_PORT: '8080' },
  };
}
