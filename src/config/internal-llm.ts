import { selectionFromEnv } from '../deployment/model.js';
import { DeploymentError } from '../runtime/errors.js';

export type InternalModelSource = 'cliproxy' | 'external';
export type InternalModelField = 'MEMORY_LLM_MODEL' | 'KNOWLEDGE_LLM_MODEL';

export function internalModelSource(env: Record<string, string>): InternalModelSource {
  const source = env.INTERNAL_LLM_SOURCE ?? 'external';
  if (source !== 'cliproxy' && source !== 'external') throw new DeploymentError('Set INTERNAL_LLM_SOURCE to cliproxy or external');
  return source;
}

export function internalModelFields(env: Record<string, string>): InternalModelField[] {
  const services = selectionFromEnv(env);
  return [
    ...(services.includes('core') ? ['MEMORY_LLM_MODEL' as const] : []),
    ...(services.includes('knowledge') ? ['KNOWLEDGE_LLM_MODEL' as const] : []),
  ];
}

export function usesLocalInternalModels(env: Record<string, string>): boolean {
  return internalModelSource(env) === 'cliproxy' && internalModelFields(env).length > 0;
}

/** Resolve the current service key each time; retained external settings remain untouched. */
export function internalLLM(env: Record<string, string>): { source: InternalModelSource; baseURL: string; apiKey: string } {
  const source = internalModelSource(env);
  return source === 'cliproxy'
    ? { source, baseURL: 'http://cli-proxy-api:8317/v1', apiKey: env.CLIPROXY_API_KEY ?? '' }
    : { source, baseURL: env.LLM_BASE_URL ?? '', apiKey: env.LLM_API_KEY ?? '' };
}
