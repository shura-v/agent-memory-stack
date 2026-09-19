import * as p from '@clack/prompts';
import { Back, Cancelled } from '../setup/interaction.js';
import type { Interaction } from '../setup/interaction.js';

export function createInteraction(
  prompts: Pick<typeof p, 'isCancel' | 'password' | 'text' | 'select' | 'multiselect' | 'confirm' | 'note'> = p,
  input: Pick<typeof process.stdin, 'on' | 'off'> & { isTTY?: boolean } = process.stdin,
  output: Pick<typeof process.stdout, 'write'> = process.stdout,
): Interaction {
  async function answer<T>(prompt: () => Promise<T>): Promise<Exclude<T, symbol>> {
    let escape = false;
    const onKeypress = (_value: string | undefined, key: { name?: string } | undefined) => {
      escape = key?.name === 'escape';
    };
    input.on('keypress', onKeypress);
    try {
      const value = await prompt();
      if (prompts.isCancel(value)) throw escape ? new Back() : new Cancelled();
      return value as Exclude<T, symbol>;
    } finally {
      input.off('keypress', onKeypress);
    }
  }
  return {
    interactive: input.isTTY === true,
    async text(q) {
      const validate = (value: string | undefined) => q.validate?.(value ?? '');
      return answer(() => (q.secret ? prompts.password({ message: q.message, validate })
        : prompts.text({ message: q.message, initialValue: q.initial, placeholder: q.placeholder, validate })));
    },
    async select(id, message, options, initial) {
      void id;
      return await answer(() => prompts.select<string>({ message, options, initialValue: initial })) as typeof options[number]['value'];
    },
    async confirm(id, message, initial = true) { void id; return answer(() => prompts.confirm({ message, initialValue: initial })); },
    async multiselect(id, message, options, initial) {
      void id;
      return await answer(() => prompts.multiselect<string>({ message, options, initialValues: initial, required: false })) as typeof initial;
    },
    note(message, title) { prompts.note(message, title); },
    print(message) { output.write(`${message}\n`); },
    async handoff(key) {
      prompts.note('Copy the key below now; ams will not save a separate copy.', 'Administrator key');
      output.write(`${key}\n\n`);
      await answer(() => prompts.select({
        message: 'I have saved the key.',
        options: [{ value: 'ok', label: 'OK', hint: 'Press Enter to continue' }],
        initialValue: 'ok',
        showInstructions: false,
      }));
    },
  };
}
export const interaction = createInteraction();
