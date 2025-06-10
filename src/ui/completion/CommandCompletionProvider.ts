// ABOUTME: Command completion provider for Ink UI command system
// ABOUTME: Integrates CommandManager with existing completion system

import type {
  CompletionProvider,
  CompletionContext,
  CompletionResult,
  CompletionItem,
} from "./types";
import { CommandManager } from "../commands/CommandManager";

export class CommandCompletionProvider implements CompletionProvider {
  constructor(private commandManager: CommandManager) {}

  canHandle(context: CompletionContext): boolean {
    // Handle if line starts with /
    const trimmedLine = context.line.trim();
    return trimmedLine.startsWith("/");
  }

  getCompletions(prefix: string): CompletionResult {
    const trimmedPrefix = prefix.trim();

    // If it's just '/', show all commands
    if (trimmedPrefix === "/") {
      const completions = this.commandManager.getCompletions("");
      return {
        items: completions.map((cmd) => this.convertToCompletionItem(cmd)),
        prefix: "/",
      };
    }

    // If it starts with '/', extract command part
    if (trimmedPrefix.startsWith("/")) {
      const commandPart = trimmedPrefix.slice(1); // Remove leading /

      // Check if we have a space - means we're completing parameters
      const spaceIndex = commandPart.indexOf(" ");
      if (spaceIndex !== -1) {
        const commandName = commandPart.slice(0, spaceIndex);
        const paramPrefix = commandPart.slice(spaceIndex + 1);

        // For now, return empty - parameter completion would need agent/tool context
        // This could be extended later for tool name completion in /auto-approve, /deny
        return {
          items: [],
          prefix: paramPrefix,
        };
      }

      // Completing command name
      const completions = this.commandManager.getCompletions(commandPart);
      return {
        items: completions.map((cmd) => this.convertToCompletionItem(cmd)),
        prefix: commandPart,
      };
    }

    // Not a command
    return {
      items: [],
      prefix: "",
    };
  }

  private convertToCompletionItem(cmd: any): CompletionItem {
    const paramStr = cmd.parameterDescription
      ? ` ${cmd.parameterDescription}`
      : "";

    return {
      value: `/${cmd.value}${paramStr}`,
      description: cmd.description,
      type: "command",
      priority: 100, // Commands get high priority
    };
  }
}
