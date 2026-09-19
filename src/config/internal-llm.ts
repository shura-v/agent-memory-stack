export type InternalModelField = 'MEMORY_LLM_MODEL' | 'KNOWLEDGE_LLM_MODEL';

export function internalModelSource(env: Record<string, string>): string {
  return env.INTERNAL_LLM_SOURCE ?? 'external';
}

export function internalModelFields(): InternalModelField[] {
  return ['MEMORY_LLM_MODEL', 'KNOWLEDGE_LLM_MODEL'];
}

export function usesLocalInternalModels(env: Record<string, string>): boolean {
  return internalModelSource(env) === 'cliproxy';
}

/** Resolve the current service key each time; retained external settings remain untouched. */
export function internalLLM(env: Record<string, string>): { source: string; baseURL: string; apiKey: string } {
  const source = internalModelSource(env);
  return source === 'cliproxy'
    ? { source, baseURL: 'http://cli-proxy-api:8317/v1', apiKey: env.CLIPROXY_API_KEY ?? '' }
    : { source, baseURL: env.LLM_BASE_URL ?? '', apiKey: env.LLM_API_KEY ?? '' };
}
