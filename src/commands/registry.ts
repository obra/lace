// ABOUTME: Command registry for storing and looking up commands with alias support
// ABOUTME: Central store for all commands (system and user-defined) with efficient lookup and auto-discovery

import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { Command } from '~/commands/types';
import { logger } from '~/utils/logger';

/**
 * Check if an export is a valid Command
 */
function isValidCommand(obj: unknown): obj is Command {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  return (
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.execute === 'function'
  );
}

/**
 * Central registry for all commands
 * Handles registration, lookup, and alias resolution
 */
export class CommandRegistry {
  private commands = new Map<string, Command>();
  private aliases = new Map<string, string>();

  /**
   * Register a command and its aliases
   */
  register(command: Command): void {
    this.commands.set(command.name, command);

    // Register aliases
    command.aliases?.forEach((alias) => {
      this.aliases.set(alias, command.name);
    });
  }

  /**
   * Get a command by name or alias
   */
  get(name: string): Command | undefined {
    const commandName = this.aliases.get(name) || name;
    return this.commands.get(commandName);
  }

  /**
   * Get all registered commands
   */
  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Create registry with auto-discovery of system commands
   */
  static async createWithAutoDiscovery(): Promise<CommandRegistry> {
    const registry = new CommandRegistry();

    // Get the directory path for the commands folder
    const currentFile = fileURLToPath(import.meta.url);
    const commandsDir = dirname(currentFile);
    const systemDir = `${commandsDir}/system`;

    // Find all command files matching *.js pattern
    const commandFiles = await glob('*.js', {
      cwd: systemDir.replace('/src/', '/dist/'),
      absolute: true,
    });

    // Also check for TypeScript files in development (exclude .d.ts files)
    const tsCommandFiles = await glob('*.ts', {
      cwd: systemDir,
      absolute: true,
      ignore: ['**/*.d.ts'],
    });

    // Use TS files if available (development), otherwise use JS files (production)
    const filesToProcess = tsCommandFiles.length > 0 ? tsCommandFiles : commandFiles;

    let helpCommandFactory: ((registry: CommandRegistry) => Command) | null = null;

    // First pass: register all direct command exports
    for (const file of filesToProcess) {
      try {
        const module = (await import(file)) as Record<string, unknown>;

        // Check all exports in the module
        for (const [exportName, exportedValue] of Object.entries(module)) {
          if (isValidCommand(exportedValue)) {
            registry.register(exportedValue);
          } else if (exportName === 'createHelpCommand' && typeof exportedValue === 'function') {
            // Store help command factory for later
            helpCommandFactory = exportedValue as (registry: CommandRegistry) => Command;
          }
        }
      } catch (error) {
        logger.warn('Failed to load command from file', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Second pass: create and register help command after all other commands are loaded
    if (helpCommandFactory) {
      try {
        const helpCommand = helpCommandFactory(registry);
        registry.register(helpCommand);
      } catch (error) {
        logger.warn('Failed to create help command', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return registry;
  }
}
