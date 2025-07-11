// ABOUTME: Help command that shows available commands and their descriptions
// ABOUTME: Dynamically generates help from registered commands in the registry

import type { Command, UserInterface } from '~/commands/types.js';
import type { CommandRegistry } from '~/commands/registry.js';

export function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: 'help',
    description: 'Show available commands',

    async execute(args: string, ui: UserInterface): Promise<void> {
      const trimmedArgs = args.trim();

      if (trimmedArgs) {
        // Show help for specific command
        const command = registry.get(trimmedArgs);
        if (!command) {
          ui.displayMessage(`Unknown command: ${trimmedArgs}`);
          return;
        }

        let helpText = `/${command.name} - ${command.description}`;
        if (command.aliases && command.aliases.length > 0) {
          helpText += `\nAliases: ${command.aliases.map((a) => `/${a}`).join(', ')}`;
        }

        ui.displayMessage(helpText);
      } else {
        // Show all commands
        const commands = registry.getAllCommands();
        if (commands.length === 0) {
          ui.displayMessage('No commands available');
          return;
        }

        const helpText = [
          'Available commands:',
          ...commands.map((cmd) => `  /${cmd.name} - ${cmd.description}`),
        ].join('\n');

        ui.displayMessage(helpText);
      }
    },
  };
}
