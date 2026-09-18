import { setupServer, applyServer } from '../setup/server.js';
import type { Interaction } from '../setup/interaction.js';
import { navigate } from '../setup/navigation.js';
import { targetStore } from '../setup/targets.js';
import type { TargetStore } from '../setup/targets.js';
import { DeploymentError } from '../runtime/errors.js';
import { run } from './run.js';
import { join } from 'node:path';
import { detectExistingInstallation } from '../runtime/installation.js';
import { updateTdai } from '../build/update-tdai.js';
import { showConnectionDetails } from '../setup/connection-info.js';

export type Command = { action: 'setup' } | { action: 'help' } | { action: 'apply' } | { action: 'update-tdai' };
export function parseCommand(args: string[]): Command {
  if (!args.length) return { action: 'setup' };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { action: 'help' };
  if (args.length === 1 && args[0] === 'apply') return { action: 'apply' };
  if (args.length === 2 && args[0] === 'update' && args[1] === 'tdai') return { action: 'update-tdai' };
  throw new DeploymentError('Usage: ams | ams apply | ams update tdai | ams --help');
}

export const help = `ams — Agent Memory Stack

ams                  Open the stack menu
ams apply            Apply saved configuration
ams update tdai      Update TDAI and apply saved configuration

Setup saves configuration before asking "Apply configuration now?".
No keeps it saved for later; Yes applies it immediately.
Apply uses the most recently saved setup location for this OS user.
Update uses the same location and downloads the latest TDAI feat/server_team revision.
Initial setup generates the administrator key. Core stores it; AMS saves no separate copy.
Choose Show connection details in the menu for saved ports and all configured keys.
Configure stack checks existing containers; edit .env and run ams apply.

Requires Node.js 24+. Server apply requires Docker/Podman with Compose.
Missing server images are built automatically from pinned sources.`;

interface Workflows {
  setupServer: typeof setupServer;
  applyServer: typeof applyServer;
}
export async function executeCommand(command: Exclude<Command, { action: 'help' }>, ui: Interaction,
  options: { targets?: TargetStore; workflows?: Workflows; detectInstallation?: typeof detectExistingInstallation; updateTdai?: typeof updateTdai; showConnectionDetails?: typeof showConnectionDetails } = {}): Promise<void> {
  const targets = options.targets ?? targetStore;
  const workflows = options.workflows ?? { setupServer, applyServer };
  async function savedDirectory(): Promise<string> {
    const path = await targets.recall('server');
    if (!path) throw new DeploymentError('No saved configuration. Run ams and choose Configure stack first.');
    return path;
  }
  async function applySaved(questions: Interaction): Promise<void> {
    const path = await savedDirectory();
    questions.note(path, 'Apply saved configuration');
    await workflows.applyServer(questions, path, { targets });
  }
  if (command.action === 'update-tdai') {
    const path = await savedDirectory();
    ui.note(path, 'Update TDAI');
    const { previousRevision, revision } = await (options.updateTdai ?? updateTdai)(path);
    ui.note(`${previousRevision} → ${revision}\nApplying saved configuration.`, 'TDAI revision');
    await navigate(ui, questions => workflows.applyServer(questions, path, { targets }));
    return;
  }
  if (command.action === 'setup') {
    await run(ui, { apply: applySaved,
      connections: async questions => (options.showConnectionDetails ?? showConnectionDetails)(questions, await savedDirectory()),
      configure: async questions => {
        const existing = await (options.detectInstallation ?? detectExistingInstallation)();
        if (existing) {
          questions.note('The stack’s containers already exist.\n'
            + (existing.directory ? `Edit ${join(existing.directory, '.env')} to change configuration.` : 'Edit the existing Compose project’s .env to change configuration.')
            + '\nApply saved changes with: ams apply',
          'Stack already configured');
          return;
        }
        await workflows.setupServer(questions, { targets });
      },
    });
    return;
  }
  await navigate(ui, applySaved);
}
