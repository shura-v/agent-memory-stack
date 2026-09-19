import { Back, Cancelled } from './interaction.js';
import type { Interaction } from './interaction.js';

type Entry = { kind: string; id: string; signature: string; value: unknown };

/** Replay only the question phase; commit() prevents replay of subsequent effects. */
export async function navigate<T>(ui: Interaction, workflow: (questions: Interaction) => Promise<T>): Promise<T> {
  const history: Entry[] = [];
  let cursor = 0;
  let replayUntil = 0;
  let committed = false;

  function entry(kind: string, id: string, signature: string): Entry | undefined {
    const previous = history[cursor];
    if (previous && (previous.kind !== kind || previous.id !== id || previous.signature !== signature)) {
      history.splice(cursor);
      replayUntil = Math.min(replayUntil, cursor);
      return undefined;
    }
    return previous;
  }

  async function ask<V>(kind: string, id: string, signature: string, prompt: (previous?: V) => Promise<V>, valid: (value: V) => boolean = () => true): Promise<V> {
    if (committed) return prompt();
    let previous = entry(kind, id, signature);
    if (previous && !valid(previous.value as V)) {
      history.splice(cursor);
      replayUntil = Math.min(replayUntil, cursor);
      previous = undefined;
    }
    if (previous && cursor < replayUntil) {
      cursor++;
      return previous.value as V;
    }
    const value = await prompt(previous?.value as V | undefined);
    if (!previous || JSON.stringify(previous.value) !== JSON.stringify(value)) history.splice(cursor);
    history[cursor++] = { kind, id, signature, value };
    return value;
  }

  const questions: Interaction = {
    interactive: ui.interactive,
    text(q) {
      return ask<string>('text', q.id, JSON.stringify([q.message, q.secret]), async previous => {
        if (q.secret && previous !== undefined) {
          const value = await ui.text({ ...q, initial: undefined,
            message: `${q.message} (Enter to keep the previous value)`,
            validate: value => value === '' ? undefined : q.validate?.(value) });
          return value === '' ? previous : value;
        }
        return ui.text({ ...q, initial: q.secret ? undefined : previous ?? q.initial });
      }, value => !q.validate?.(value));
    },
    select(id, message, options, initial) {
      return ask('select', id, JSON.stringify([message, options]), previous => ui.select(id, message, options, previous ?? initial),
        value => options.some(option => option.value === value));
    },
    multiselect(id, message, options, initial) {
      return ask('multiselect', id, JSON.stringify([message, options]), previous => ui.multiselect(id, message, options, previous ?? initial),
        values => values.every(value => options.some(option => option.value === value)));
    },
    confirm(id, message, initial) {
      return ask('confirm', id, message, previous => ui.confirm(id, message, previous ?? initial));
    },
    handoff(key) {
      return ask<void>('handoff', 'admin-key', key, () => ui.handoff(key));
    },
    note(message, title) {
      if (committed || cursor >= replayUntil) ui.note(message, title);
    },
    print(message) {
      if (committed || cursor >= replayUntil) ui.print(message);
    },
    memo<V>(id: string, create: () => V, dependencies: readonly unknown[] = []): V {
      if (committed) return create();
      const signature = JSON.stringify(dependencies);
      const previous = entry('memo', id, signature);
      if (previous) { cursor++; return previous.value as V; }
      const value = create();
      history[cursor++] = { kind: 'memo', id, signature, value };
      return value;
    },
    commit() {
      committed = true;
      history.length = 0;
      ui.commit?.();
    },
  };

  try {
    for (;;) {
      cursor = 0;
      try { return await workflow(questions); }
      catch (error) {
        if (!(error instanceof Back)) throw error;
        if (committed) throw new Cancelled();
        let previous = cursor - 1;
        while (previous >= 0 && history[previous].kind === 'memo') previous--;
        if (previous < 0) throw new Cancelled();
        replayUntil = previous;
      }
    }
  } finally {
    history.length = 0;
  }
}
