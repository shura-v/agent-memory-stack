import { useSyncExternalStore, type ReactNode } from 'react';
let knowledge = false;
const listeners = new Set<() => void>();
void fetch('/ams/features', { redirect: 'error' }).then(response => response.ok ? response.json() : null).then(value => {
  knowledge = value?.knowledge === true;
  for (const listener of listeners) listener();
}).catch(() => {});
export function useAmsKnowledge(): boolean {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => knowledge, () => false);
}
export function AmsKnowledge({ children }: { children: ReactNode }) {
  return useAmsKnowledge() ? children : <p>Knowledge is unavailable in this deployment.</p>;
}
