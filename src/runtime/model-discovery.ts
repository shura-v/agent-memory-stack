
export type ModelDiscovery = (baseUrl: string, apiKey: string) => Promise<string[]>;

export class ModelAccessError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'The API rejected your key (HTTP 401). Check the API key and base URL.'
      : 'The API denied access to the model list (HTTP 403). Check the API key, permissions, and base URL.');
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
      const url = `${baseUrl.replace(/\/+$/, '')}/models`;
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
