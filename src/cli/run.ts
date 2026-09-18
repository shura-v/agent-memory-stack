import type { Interaction } from '../setup/interaction.js';
import { navigate } from '../setup/navigation.js';

export async function run(ui: Interaction, actions: Record<'configure' | 'apply' | 'connections', (ui: Interaction) => Promise<void>>): Promise<void> {
  ui.note('Esc: previous question. Ctrl+C: cancel. Back navigation ends when configuration is saved. Declining immediate apply keeps the saved configuration for later.', 'Navigation');
  await navigate(ui, async questions => {
    const action = await questions.select<'configure' | 'apply' | 'connections'>('action', 'Agent Memory Stack', [
      { value: 'configure', label: 'Configure stack' },
      { value: 'apply', label: 'Apply configuration' },
      { value: 'connections', label: 'Show connection details' },
    ], 'configure');
    await actions[action](questions);
  });
}
