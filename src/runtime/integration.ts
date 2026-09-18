import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { fetchIdentity, IntegrationError, requirePairing, serviceEndpoint, serviceHeaders } from './service-identity.js';

export interface ProbeConfig {
  checks: Array<{ name: string; kind: 'core' | 'model' | 'knowledge' | 'panel' | 'knowledge-tools'; url: string; key: string; serviceId?: string }>;
  pairings?: Array<{ knowledgeUrl: string; panelUrl: string; coreUrl: string; key: string }>;
  toolsPairings?: Array<{ knowledgeToolsUrl: string; coreUrl: string; key: string }>;
  mode?: 'preflight' | 'verify';
}
export async function probeIntegration(config: ProbeConfig, fetcher: typeof fetch = fetch): Promise<{ pending: string[] }> {
  const pending: string[] = [];
  if (!Array.isArray(config.checks)) throw new Error('Invalid integration checks');
  async function check(name: string, action: () => Promise<unknown>): Promise<void> {
    try { await action(); }
    catch (error) {
      if (error instanceof IntegrationError && error.status === 503) pending.push(name);
      else throw new Error(`Integration check failed: ${name}: ${error instanceof IntegrationError ? error.message : 'Invalid dependency configuration'}`);
    }
  }
  for (const entry of config.checks) await check(entry.name, async () => {
    if (!entry.key || (entry.serviceId && entry.serviceId !== 'ams')) throw new Error('Missing service authentication');
    serviceEndpoint(entry.url, '/ams/identity');
    if (entry.kind !== 'model') {
      const identity = await fetchIdentity(entry.url, entry.key, fetcher);
      if (entry.kind === 'core' && (identity.knowledgeId || identity.panelId)
        || (entry.kind === 'knowledge' || entry.kind === 'knowledge-tools') && (!identity.knowledgeId || identity.panelId)
        || entry.kind === 'panel' && !identity.panelId) throw new IntegrationError(409, 'Wrong service identity');
      return;
    }
    let response: Response;
    try { response = await fetcher(serviceEndpoint(entry.url, '/models'), { headers: serviceHeaders(entry.key), redirect: 'manual', signal: AbortSignal.timeout(5000) }); }
    catch { throw new IntegrationError(503, 'Model upstream unavailable'); }
    if ([401, 403].includes(response.status)) throw new IntegrationError(response.status, 'Model authentication rejected');
    if (response.status >= 500) throw new IntegrationError(503, 'Model upstream unavailable');
    if (!response.ok) throw new IntegrationError(409, 'Model endpoint rejected');
    let models: unknown;
    try { models = await response.json(); } catch { throw new IntegrationError(409, 'Invalid model API response'); }
    if (!models || typeof models !== 'object' || !('data' in models) || !Array.isArray(models.data)) throw new IntegrationError(409, 'Invalid model API response');
  });
  for (const pairing of config.toolsPairings || []) await check('Core/protected Knowledge tools pairing', async () => {
    const core = await fetchIdentity(pairing.coreUrl, pairing.key, fetcher);
    const knowledge = await fetchIdentity(pairing.knowledgeToolsUrl, pairing.key, fetcher);
    if (core.knowledgeId || core.panelId || !knowledge.knowledgeId || knowledge.panelId || core.coreId !== knowledge.coreId) {
      throw new IntegrationError(409, 'Core and protected Knowledge tools identity mismatch');
    }
  });
  for (const pairing of config.pairings || []) await check('Knowledge/Panel pairing', async () => {
    const core = await fetchIdentity(pairing.coreUrl, pairing.key, fetcher);
    const knowledge = await fetchIdentity(pairing.knowledgeUrl, pairing.key, fetcher);
    if (core.coreId !== knowledge.coreId) throw new IntegrationError(409, 'Core identity mismatch');
    const panel = await requirePairing(knowledge, pairing.panelUrl, pairing.key, fetcher);
    let response: Response;
    try { response = await fetcher(serviceEndpoint(pairing.knowledgeUrl, '/ams/integration'), { headers: serviceHeaders(pairing.key), redirect: 'manual', signal: AbortSignal.timeout(10_000) }); }
    catch { throw new IntegrationError(503, 'Reverse integration unavailable'); }
    if (response.status >= 500) throw new IntegrationError(503, 'Reverse integration unavailable');
    if (!response.ok) throw new IntegrationError(response.status, 'Reverse integration rejected');
    let reverse: unknown;
    try { reverse = await response.json(); } catch { throw new IntegrationError(409, 'Invalid reverse identity'); }
    if (!reverse || typeof reverse !== 'object' || !('coreId' in reverse) || !('knowledgeId' in reverse) || !('panelId' in reverse)
      || reverse.coreId !== core.coreId || reverse.knowledgeId !== knowledge.knowledgeId || reverse.panelId !== panel.panelId) throw new IntegrationError(409, 'Reverse integration identity mismatch');
  });
  return { pending };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input: string;
    if (process.argv.includes('--stdin')) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 256 * 1024) throw new Error('Integration config exceeds limit'); chunks.push(bytes); }
      input = Buffer.concat(chunks).toString('utf8');
    } else input = await readFile(process.argv[2] || '/config/integration.json', 'utf8');
    console.log(JSON.stringify(await probeIntegration(JSON.parse(input) as ProbeConfig)));
  } catch (error) { console.log(JSON.stringify({ pending: [], error: error instanceof Error && error.message.startsWith('Integration check failed:') ? error.message : 'Invalid integration configuration' })); }
}
