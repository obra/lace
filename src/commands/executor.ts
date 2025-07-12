// ABOUTME: Command executor that parses slash commands and executes them
// ABOUTME: Handles parsing /command args syntax and coordinating with registry for execution

import type { UserInterface, ParsedCommand } from '~/commands/types';
import type { CommandRegistry } from '~/commands/registry';

/**
 * Executes commands by parsing input and coordinating with registry
 */
export class CommandExecutor {
  constructor(private registry: CommandRegistry) {}

  /**
   * Execute a command from user input
   */
  async execute(input: string, ui: UserInterface): Promise<void> {
    const parsed = this.parseCommand(input);
    if (!parsed) return;

    const command = this.registry.get(parsed.command);
    if (!command) {
      ui.displayMessage(`Unknown command: ${parsed.command}`);
      return;
    }

    try {
      await command.execute(parsed.args, ui);
    } catch (error) {
      ui.displayMessage(
        `Command failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse slash command input into command and args
   */
  private parseCommand(input: string): ParsedCommand | null {
    if (!input.startsWith('/')) return null;

    const parts = input.slice(1).split(' ');
    const command = parts[0];
    const args = parts.slice(1).join(' ');
    const argv = parts.slice(1);

    return { command, args, argv };
  }
}
