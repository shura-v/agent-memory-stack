import { apiBase } from '../config/settings.js';
import { serviceEndpoint } from '../runtime/service-identity.js';

export type ModelDiscovery = (baseUrl: string, apiKey: string) => Promise<string[]>;

/** Best-effort discovery; manual model entry remains available on any failure. */
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
    } catch { return []; }
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
