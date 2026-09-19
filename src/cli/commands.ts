import { setupServer, applyServer } from '../setup/server.js';
import type { Interaction } from '../setup/interaction.js';
import { navigate } from '../setup/navigation.js';
import { configurationDirectory, displayHomePath } from '../setup/paths.js';
import { exists } from '../setup/server-settings.js';
import { DeploymentError } from '../runtime/errors.js';
import { run } from './run.js';
import { join, resolve } from 'node:path';
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
Configuration lives in ~/.agent-memory-stack for this OS user.
Apply and update use this fixed directory from any working directory.
Update downloads the latest TDAI feat/server_team revision.
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
  options: { directory?: string; workflows?: Workflows; detectInstallation?: typeof detectExistingInstallation; updateTdai?: typeof updateTdai; showConnectionDetails?: typeof showConnectionDetails } = {}): Promise<void> {
  const directory = resolve(options.directory ?? configurationDirectory());
  const workflows = options.workflows ?? { setupServer, applyServer };
  async function savedDirectory(): Promise<string> {
    if (!await exists(join(directory, '.env'))) throw new DeploymentError('No saved configuration. Run ams and choose Configure stack first.');
    return directory;
  }
  async function applySaved(questions: Interaction): Promise<void> {
    const path = await savedDirectory();
    questions.note(displayHomePath(path), 'Apply saved configuration');
    await workflows.applyServer(questions, path);
  }
  if (command.action === 'update-tdai') {
    const path = await savedDirectory();
    ui.note(displayHomePath(path), 'Update TDAI');
    const { previousRevision, revision } = await (options.updateTdai ?? updateTdai)(path);
    ui.note(`${previousRevision} → ${revision}\nApplying saved configuration.`, 'TDAI revision');
    await navigate(ui, questions => workflows.applyServer(questions, path));
    return;
  }
  if (command.action === 'setup') {
    await run(ui, { apply: applySaved,
      connections: async questions => (options.showConnectionDetails ?? showConnectionDetails)(questions, await savedDirectory()),
      configure: async questions => {
        const existing = await (options.detectInstallation ?? detectExistingInstallation)();
        if (existing) {
          questions.note('The stack’s containers already exist.\n'
            + (existing.directory ? `Edit ${displayHomePath(join(existing.directory, '.env'))} to change configuration.` : 'Edit the existing Compose project’s .env to change configuration.')
            + (existing.directory && resolve(existing.directory) === directory
              ? '\nApply saved changes with: ams apply'
              : '\nApply changes manually with that installation’s Compose project and configuration.'),
          'Stack already configured');
          return;
        }
        await workflows.setupServer(questions, { directory });
      },
    });
    return;
  }
  await navigate(ui, applySaved);
}
