import { apiBase } from '../config/settings.js';
import { serviceEndpoint } from './service-identity.js';
import { DeploymentError } from './errors.js';
import { pathToFileURL } from 'node:url';

export type ModelDiscovery = (baseUrl: string, apiKey: string) => Promise<string[]>;

export class ModelAccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'The API rejected your key (HTTP 401). Check the API key and base URL.'
      : 'The API denied access to the model list (HTTP 403). Check the API key, permissions, and base URL.');
  }
}

export class InternalModelAccessError extends DeploymentError {
  constructor(readonly status: 401 | 403) {
    super(`CLIProxyAPI rejected internal model discovery (HTTP ${status}). Check CLIPROXY_API_KEY and the selected account authorization, then retry ams apply.`);
  }
}

/** Unsupported/unavailable discovery permits manual entry; explicit access failures remain visible. */
export async function discoverModels(baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = 1024 * 1024;
  const load = async (): Promise<string[]> => {
    try {
      const url = serviceEndpoint(apiBase(baseUrl), '/models');
      if (!apiKey || apiKey.trim() !== apiKey || /[\x00-\x1f\x7f]/.test(apiKey)) return [];
      const response = await fetcher(url, {
        method: 'GET', headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        redirect: 'error', signal: controller.signal,
      });
      reader = response.body?.getReader();
      if (response.status === 401 || response.status === 403) throw new ModelAccessError(response.status);
      if (!response.ok || !reader || Number(response.headers.get('content-length')) > limit) return [];
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) return [];
        chunks.push(chunk.value);
      }
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) return [];
      const ids = payload.data.flatMap((item: unknown) => {
        if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string'
          || !item.id.trim() || item.id !== item.id.trim() || /[\x00-\x1f\x7f-\x9f]/.test(item.id)) return [];
        return [item.id];
      });
      return [...new Set(ids)];
    } catch (error) {
      if (error instanceof ModelAccessError) throw error;
      return [];
    }
  };
  try {
    return await Promise.race([
      load(),
      new Promise<string[]>(resolve => { timer = setTimeout(() => { controller.abort(); resolve([]); }, 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

// Runtime containers receive credentials through stdin, never process arguments.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 64 * 1024) throw new Error('Discovery input exceeds limit');
      chunks.push(bytes);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { baseUrl: string; apiKey: string };
    console.log(JSON.stringify({ models: await discoverModels(input.baseUrl, input.apiKey) }));
  } catch (error) {
    console.log(JSON.stringify(error instanceof ModelAccessError ? { models: [], status: error.status } : { models: [] }));
  }
}
