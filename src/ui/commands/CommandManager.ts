// ABOUTME: Core command management system for Ink UI
// ABOUTME: Handles command registration, parsing, execution and completion

import type {
  Command,
  CommandContext,
  CommandResult,
  CommandRegistry,
  CommandCompletion,
} from "./types";

export class CommandManager {
  private commands: CommandRegistry = {};
  private aliases: Map<string, string> = new Map();

  /**
   * Register a single command
   */
  register(command: Command): void {
    this.commands[command.name] = command;

    // Register aliases if present
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }
  }

  /**
   * Register multiple commands at once
   */
  registerAll(commands: Command[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  /**
   * Check if a command exists (including aliases)
   */
  hasCommand(name: string): boolean {
    return name in this.commands || this.aliases.has(name);
  }

  /**
   * Get command by name (resolves aliases)
   */
  private getCommand(name: string): Command | undefined {
    const commandName = this.aliases.get(name) || name;
    return this.commands[commandName];
  }

  /**
   * Check if input string is a command
   */
  isCommand(input: string): boolean {
    return input.startsWith("/") && input.length > 1;
  }

  /**
   * Parse command input into command name and arguments
   */
  parseCommand(input: string): { command: string; args: string[] } {
    if (!this.isCommand(input)) {
      return { command: "", args: [] };
    }

    const parts = input.slice(1).trim().split(/\s+/);
    const command = parts[0] || "";
    const args = parts.slice(1);

    return { command, args };
  }

  /**
   * Execute a command with given context
   */
  async execute(
    input: string,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { command: commandName, args } = this.parseCommand(input);

    if (!commandName) {
      return {
        success: false,
        message: "Empty command. Type /help for available commands.",
      };
    }

    const command = this.getCommand(commandName);
    if (!command) {
      return {
        success: false,
        message: `Unknown command: ${commandName}. Type /help for available commands.`,
      };
    }

    // Check agent requirement
    if (command.requiresAgent && !context.agent) {
      return {
        success: false,
        message: "No agent available. This command requires an active agent.",
      };
    }

    try {
      const result = await command.handler(args, context);
      return result;
    } catch (error) {
      return {
        success: false,
        message: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * List all registered commands
   */
  listCommands(includeHidden: boolean = false): Command[] {
    return Object.values(this.commands).filter(
      (cmd) => includeHidden || !cmd.hidden,
    );
  }

  /**
   * Get command completions for autocomplete
   */
  getCompletions(prefix: string): CommandCompletion[] {
    const commands = this.listCommands(false);
    return commands
      .filter((cmd) => cmd.name.startsWith(prefix))
      .map((cmd) => ({
        value: cmd.name,
        description: cmd.description,
        type: "command" as const,
        hasParameters: !!cmd.parameterDescription,
        parameterDescription: cmd.parameterDescription,
      }));
  }

  /**
   * Get detailed help for all commands
   */
  getHelpText(): string {
    const commands = this.listCommands(false);
    const lines = ["Available commands:"];

    for (const cmd of commands) {
      const paramStr = cmd.parameterDescription
        ? ` ${cmd.parameterDescription}`
        : "";
      const aliasStr = cmd.aliases
        ? ` (aliases: ${cmd.aliases.join(", ")})`
        : "";
      lines.push(`  /${cmd.name}${paramStr} - ${cmd.description}${aliasStr}`);
    }

    return lines.join("\n");
  }
}
