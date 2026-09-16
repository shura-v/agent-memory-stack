#!/usr/bin/env node
import { executeCommand, help, parseCommand } from './cli/commands.js';
import { interaction } from './cli/interaction.js';
import { Cancelled } from './setup/interaction.js';
import { DeploymentError } from './runtime/errors.js';
import { ProcessFailure } from './runtime/process.js';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('ams requires Node.js 24 or newer. Switch Node.js and run ams again.');
  process.exitCode = 1;
} else {
  try {
    const command = parseCommand(process.argv.slice(2));
    if (command.action === 'help') console.log(help);
    else if (!process.stdin.isTTY || !process.stdout.isTTY) throw new DeploymentError('Run ams in an interactive terminal. Use --help for usage.');
    else await executeCommand(command, interaction);
  }
  catch (error) {
    if (error instanceof Cancelled) console.log('Cancelled. Any configuration already saved is retained.');
    else {
      // Prompt validation is specific; untrusted filesystem/runtime failures
      // must never echo secret-bearing input or upstream response bodies.
      console.error(error instanceof ProcessFailure || error instanceof DeploymentError ? error.message : 'Setup failed. Check the last stage, configuration and container logs; secrets are omitted.');
      process.exitCode = 1;
    }
  }
}
