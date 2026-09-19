export class Cancelled extends Error { constructor() { super('Setup cancelled'); } }
export class Back extends Error { constructor() { super('Previous question'); } }
export type Question = { id: string; message: string; initial?: string; placeholder?: string; secret?: boolean; validate?: (value: string) => string | undefined };
export interface Interaction {
  /** False for real terminal adapters without interactive input. Test adapters may omit it. */
  interactive?: boolean;
  text(question: Question): Promise<string>;
  select<T extends string>(id: string, message: string, options: { value: T; label: string }[], initial?: T): Promise<T>;
  multiselect<T extends string>(id: string, message: string, options: { value: T; label: string }[], initial: T[]): Promise<T[]>;
  confirm(id: string, message: string, initial?: boolean): Promise<boolean>;
  note(message: string, title?: string): void;
  /** Explicit copyable output; never used by automatic apply logs for secrets. */
  print(message: string): void;
  handoff(key: string): Promise<void>;
  /** Reuse generated values and read-only lookups while navigating questions. */
  memo?<T>(id: string, create: () => T, dependencies?: readonly unknown[]): T;
  /** End back navigation before saving configuration or performing apply effects. */
  commit?(): void;
}

export function remember<T>(ui: Interaction, id: string, create: () => T, dependencies: readonly unknown[] = []): T {
  return ui.memo ? ui.memo(id, create, dependencies) : create();
}
