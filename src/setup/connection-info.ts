import { join } from 'node:path';
import { readEnv } from '../config/files.js';
import { validateEnv } from '../config/settings.js';
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
    const raw = await readEnv(join(directory, '.env'));
    if (!Object.keys(raw).length) throw new Error();
    env = validateEnv(raw, { allowPendingModels: true });
  } catch {
    throw new DeploymentError('Cannot read saved connection settings. Check .env or run ams and choose Configure stack.');
  }
  const plan = resolveDeployment(env);
  const port = (service: string) => plan.interfaces.find(item => item.service === service)?.port;
  const block = (title: string, lines: string[]) => ui.print([title, ...lines].join('\n') + '\n');
  const credential = (name: string, label: string) => env[name] ? [`${label} (${name}):`, env[name]] : [];
  const keys: (ConnectionKey & { value?: string })[] = [];
  let keyError: string | undefined;
  ui.print(`Show connection details\nSaved configuration from ${directory}; service availability is not checked.\nKeys are visible on this screen; terminal capture can retain them.\n`);
  if (!plan.services.includes('core')) {
    keyError = 'Core is not local. Get user keys from the Panel connected to that Core.';
  } else {
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
  block('MCP — Knowledge tools for your agent', [
    ...listener('mcp', '/mcp'), 'Transport: Streamable HTTP', 'Path: /mcp',
    'Search Wiki and code resources. Use one of these user API keys:', ...userCredentials(),
  ]);
  if (plan.services.includes('core') || env.CORE_API_KEY) block('Core — internal memory service', [
    ...(plan.services.includes('core') ? ['Compose URL: http://core:8420', ...(port('core') ? listener('core') : ['Host access: not published.'])] : ['Saved credentials; Core is not configured locally.']),
    ...credential('CORE_API_KEY', 'Service key'),
  ]);
  if (plan.services.includes('cli-proxy-api') || env.CLIPROXY_API_KEY) block('CLIProxyAPI — model provider access', [
    ...(plan.services.includes('cli-proxy-api') ? ['Compose API base URL: http://cli-proxy-api:8317/v1', ...(port('cli-proxy-api') ? listener('cli-proxy-api', '/v1') : ['Host access: not published.'])] : ['Saved credentials; CLIProxyAPI is not configured locally.']),
    ...credential('CLIPROXY_API_KEY', 'Service key'),
  ]);
  const llm = internalLLM(env);
  const modelFields = internalModelFields(env);
  if (modelFields.length) block('Internal LLM — memory and Knowledge processing', [
    `Source: ${llm.source === 'cliproxy' ? "this stack's CLIProxyAPI" : 'external API'}`,
    `API base URL: ${llm.baseURL}`,
    ...modelFields.map(name => `${name === 'MEMORY_LLM_MODEL' ? 'Core' : 'Knowledge'} model: ${env[name] || 'select during Apply after CLIProxyAPI authorization'}`),
    ...credential(llm.source === 'cliproxy' ? 'CLIPROXY_API_KEY' : 'LLM_API_KEY', 'API key'),
  ]);
  if (env.LLM_API_KEY && (llm.source === 'cliproxy' || !modelFields.length)) block('External internal-model API — saved credentials, inactive', [
    `API base URL: ${env.LLM_BASE_URL || 'not configured'}`,
    ...credential('LLM_API_KEY', 'API key'),
  ]);
  for (const remote of [
    { title: 'Remote Core', mode: plan.connections.core.mode, url: 'REMOTE_CORE_URL', key: 'REMOTE_CORE_API_KEY' },
    { title: 'Remote model provider', mode: plan.connections.model.mode, url: 'REMOTE_MODEL_BASE_URL', key: 'REMOTE_MODEL_API_KEY' },
  ]) {
    if (env[remote.key]) block(`${remote.title} — ${remote.mode === 'remote' ? 'active connection' : 'saved credentials, inactive'}`, [
      `API base URL: ${env[remote.url] || 'not configured'}`, ...credential(remote.key, 'API key'),
    ]);
  }
  block('Local or remote?', [
    'On this machine: use the localhost URLs above.',
    'On another computer: proxy each published port through Caddy and use your HTTPS domains. Preserve the request paths.',
    'Configure MemoryProxy, MCP, or both.',
  ]);
}
