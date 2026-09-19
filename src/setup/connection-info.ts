import { readInstallationEnv, composeNativeConfiguration, readNativeConfiguration } from '../config/native-state.js';
import { parseNativeDocument } from '../config/native-documents.js';
import { join } from 'node:path';
import { nativeTemplateDefinitions, type NativeFileName } from '../config/native-templates.js';
import { proxyAdminKey } from '../config/native-services.js';
import { resolveSettings } from '../config/settings.js';
import { internalLLM, internalModelFields } from '../config/internal-llm.js';
import { resolveDeployment } from '../deployment/model.js';
import { listConnectionKeys, readConnectionKey, type ConnectionKey } from '../runtime/connection-keys.js';
import { DeploymentError } from '../runtime/errors.js';
import type { Interaction } from './interaction.js';
import { savedProvider } from './server.js';

export async function showConnectionDetails(ui: Interaction, directory: string,
  options: { listKeys?: typeof listConnectionKeys; readKey?: typeof readConnectionKey } = {}): Promise<void> {
  let env: Record<string, string>;
  try {
    const raw = await readInstallationEnv(directory);
    if (!Object.keys(raw).length) throw new Error();
    env = resolveSettings(raw);
  } catch {
    throw new DeploymentError('Cannot read saved connection settings. Check orchestration .env and the recorded native defaults/overrides, or run ams and choose Configure stack.');
  }
  const plan = resolveDeployment(env);
  const port = (service: string) => plan.interfaces.find(item => item.service === service)?.port;
  const block = (title: string, lines: string[]) => ui.print([title, ...lines].join('\n') + '\n');
  const credential = (name: string, label: string) => env[name] ? [`${label} (${name}):`, env[name]] : [];
  const keys: (ConnectionKey & { value?: string })[] = [];
  let keyError: string | undefined;
  ui.print(`Show connection details\nSaved configuration from ${directory}; service availability is not checked.\nKeys are visible on this screen; terminal capture can retain them.\n`);
  try {
    const provider = await savedProvider(directory);
    const metadata = await (options.listKeys ?? listConnectionKeys)(directory, provider);
    for (const key of metadata) {
      try { keys.push({ ...key, value: await (options.readKey ?? readConnectionKey)(directory, provider, key.keyId) }); }
      catch { keys.push(key); }
    }
  } catch {
    keyError = 'Cannot read local Core keys. Start Core or use Panel → API Keys.';
  }
  const userCredentials = (adminOnly = false): string[] => {
    if (keyError) return [keyError];
    const matching = adminOnly ? keys.filter(key => key.userType === 'system_admin') : keys;
    if (!matching.length) return [adminOnly ? 'No active administrator login keys found.' : 'No active user API keys found. Manage keys in Panel → API Keys.'];
    return matching.flatMap(key => [
      `${adminOnly ? 'Administrator login key' : 'API key'} — ${key.username} / ${key.name || 'unnamed'} (…${key.suffix})${!adminOnly && key.userType === 'system_admin' ? ' [administrator, full access]' : ''}:`,
      key.value ?? 'Key no longer available. Check it in Panel → API Keys.',
    ]);
  };
  const listener = (service: string, path = ''): string[] => {
    const published = port(service);
    return published ? [`Port: ${published}`, `Local URL: http://localhost:${published}${path}`] : ['Not configured on this machine.'];
  };
  const publicOrigin = (service: string, field: string): string[] => {
    const published = port(service);
    const origin = env[field];
    return published && origin && ![`http://localhost:${published}`, `http://127.0.0.1:${published}`].includes(origin)
      ? [`Public URL: ${origin}`] : [];
  };
  block('Panel — web interface', [
    ...listener('panel'), ...publicOrigin('panel', 'PANEL_PUBLIC_URL'),
    'Sign in with an administrator key:', ...userCredentials(true),
  ]);
  block('MemoryProxy — API for your agent with memory', [
    ...listener('memory-proxy'), ...publicOrigin('memory-proxy', 'MEMORY_PROXY_PUBLIC_URL'),
    'Agent Base URL: copy the native endpoint from Panel → API Keys → Client Access Endpoint.',
    ...userCredentials(),
  ]);
  const configuration = await readNativeConfiguration(directory);
  const native = configuration ? composeNativeConfiguration(configuration) : undefined;
  const fieldSource = (file: NativeFileName, path: string[]): string => {
    const overlay = configuration?.overrides[file];
    let value: unknown = overlay === undefined ? undefined : parseNativeDocument(overlay, nativeTemplateDefinitions[file].format);
    let overridden = false;
    for (const part of path) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, part)) { overridden = false; break; }
      value = (value as Record<string, unknown>)[part]; overridden = true;
    }
    return `${join(configuration!.root, overridden ? 'overrides' : 'defaults', file)} ${path.join('.')}`;
  };
  if (configuration) block('Native configuration', [
    `Inspect upstream defaults: ${join(configuration.root, 'defaults')}`,
    `Edit installation overrides: ${join(configuration.root, 'overrides')}`,
    'Values below are composed from both sets; removing an override restores inheritance.',
  ]);
  const admin = native ? proxyAdminKey(native) : undefined;
  if (admin) block('MemoryProxy — native administration', [`Administrative key (${fieldSource('proxy.yaml', ['admin', 'apiKey'])}):`, admin]);
  block('MCP — Knowledge tools for your agent', [
    ...listener('mcp', '/mcp'), 'Transport: Streamable HTTP', 'Path: /mcp',
    'Search Wiki and code resources. Use one of these user API keys:', ...userCredentials(),
  ]);
  block('Core — internal memory service', [
    'Compose URL: http://core:8420', ...(port('core') ? listener('core') : ['Host access: not published.']),
    ...(native?.['core.yaml'] ? [`Service key (${fieldSource('core.yaml', ['server', 'apiKey'])}):`, env.CORE_API_KEY] : credential('CORE_API_KEY', 'Service key')),
  ]);
  block('CLIProxyAPI — model provider access', [
    'Compose API base URL: http://cli-proxy-api:8317/v1', ...(port('cli-proxy-api') ? listener('cli-proxy-api', '/v1') : ['Host access: not published.']),
    ...credential('CLIPROXY_API_KEY', 'Service key'),
  ]);
  const llm = internalLLM(env);
  const modelFields = internalModelFields();
  if (!native && modelFields.length) block('Internal LLM — memory and Knowledge processing', [
    `Source: ${llm.source === 'cliproxy' ? "this stack's CLIProxyAPI" : 'external API'}`,
    `API base URL: ${llm.baseURL}`,
    ...modelFields.map(name => `${name === 'MEMORY_LLM_MODEL' ? 'Core' : 'Knowledge'} model: ${env[name] ?? ''}`),
    ...credential(llm.source === 'cliproxy' ? 'CLIPROXY_API_KEY' : 'LLM_API_KEY', 'API key'),
  ]);
  if (native) {
    for (const [file, label] of [['core.yaml', 'Core'], ['knowledge.env', 'Knowledge']] as const) {
      if (!native[file]) continue;
      const value = parseNativeDocument(native[file]!, file === 'core.yaml' ? 'yaml' : 'env') as Record<string, any>;
      const llm = file === 'core.yaml' ? value.llm ?? {} : { baseUrl: value.LLM_BASE_URL, model: value.LLM_MODEL, apiKey: value.LLM_API_KEY };
      block(`${label} — native internal LLM`, [`API base URL: ${llm.baseUrl ?? ''}`, `Source: ${fieldSource(file, file === 'core.yaml' ? ['llm', 'baseUrl'] : ['LLM_BASE_URL'])}`, `Model: ${llm.model ?? ''}`, `Source: ${fieldSource(file, file === 'core.yaml' ? ['llm', 'model'] : ['LLM_MODEL'])}`, `API key (${fieldSource(file, file === 'core.yaml' ? ['llm', 'apiKey'] : ['LLM_API_KEY'])}):`, llm.apiKey ?? '']);
    }
  }
  if (native?.['proxy.yaml']) {
    const value = parseNativeDocument(native['proxy.yaml'], 'yaml') as { upstream?: { url?: string; apiKey?: string }; tdai?: { endpoint?: string; apiKey?: string } };
    block('MemoryProxy connections', [`Model API: ${value.upstream?.url ?? ''}`, `Source: ${fieldSource('proxy.yaml', ['upstream', 'url'])}`, `API key (${fieldSource('proxy.yaml', ['upstream', 'apiKey'])}):`, value.upstream?.apiKey ?? '', `Core API: ${value.tdai?.endpoint ?? ''}`, `Source: ${fieldSource('proxy.yaml', ['tdai', 'endpoint'])}`, `API key (${fieldSource('proxy.yaml', ['tdai', 'apiKey'])}):`, value.tdai?.apiKey ?? '']);
  }
  if (native?.['knowledge.env']) {
    const value = parseNativeDocument(native['knowledge.env'], 'env') as Record<string, string>;
    block('Knowledge connections', [`Panel callback URL: ${value.TMC_CALLBACK_URL ?? ''}`, `Source: ${fieldSource('knowledge.env', ['TMC_CALLBACK_URL'])}`]);
  }
  if (native?.['panel-instances.json']) {
    const value = parseNativeDocument(native['panel-instances.json'], 'json') as { instances?: Array<{ id?: string; gateway_endpoint?: string; api_key?: string }> };
    const instance = value.instances?.find(item => item.id === 'ams');
    if (instance) block('Panel connections', [`Core API: ${instance.gateway_endpoint ?? ''}`, `Source: ${fieldSource('panel-instances.json', ['instances'])}`, 'Service key:', instance.api_key ?? '']);
  }
  if (!native && env.LLM_API_KEY && (llm.source === 'cliproxy' || !modelFields.length)) block('External internal-model API — saved credentials, inactive', [
    `API base URL: ${env.LLM_BASE_URL || 'not configured'}`,
    ...credential('LLM_API_KEY', 'API key'),
  ]);
  block('Local or remote?', [
    'On this machine: use the localhost URLs above.',
    'On another computer: proxy each published port through Caddy and use your HTTPS domains. Preserve the request paths.',
    'Configure MemoryProxy, MCP, or both.',
  ]);
}
