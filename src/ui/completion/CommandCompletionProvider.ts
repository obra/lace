// ABOUTME: Command completion provider for slash commands
// ABOUTME: Extracted from console.js, provides clean API for command auto-completion

import { CompletionProvider, CompletionResult, CompletionContext, CompletionItem } from './types.js';

interface CommandDefinition {
  command: string;
  description: string;
  requiresAgent?: boolean;
  parameters?: string;
}

export class CommandCompletionProvider implements CompletionProvider {
  private commands: Map<string, CommandDefinition>;

  constructor() {
    this.commands = new Map();
    this.initializeDefaultCommands();
  }

  private initializeDefaultCommands() {
    // Core commands extracted from console.js
    const defaultCommands: CommandDefinition[] = [
      { command: '/help', description: 'Show help information' },
      { command: '/tools', description: 'List available tools', requiresAgent: true },
      { command: '/memory', description: 'Show conversation history', requiresAgent: true },
      { command: '/status', description: 'Show agent status and context usage', requiresAgent: true },
      { command: '/approval', description: 'Show tool approval settings', requiresAgent: true },
      { command: '/quit', description: 'Exit lace' },
      { command: '/clear', description: 'Clear conversation history', requiresAgent: true },
      { command: '/auto-approve', description: 'Auto-approve specific tools', parameters: '<tool-name>' },
      { command: '/deny', description: 'Deny specific tools', parameters: '<tool-name>' },
      { command: '/reset-approval', description: 'Reset tool approval settings', requiresAgent: true },
      { command: '/save', description: 'Save conversation to file', parameters: '<filename>' },
      { command: '/load', description: 'Load conversation from file', parameters: '<filename>' },
      { command: '/model', description: 'Show or change AI model', parameters: '[model-name]' },
      { command: '/verbose', description: 'Toggle verbose output' },
    ];

    for (const cmd of defaultCommands) {
      this.commands.set(cmd.command, cmd);
    }
  }

  canHandle(context: CompletionContext): boolean {
    return context.lineNumber === 0 && context.line.startsWith('/');
  }

  getCompletions(prefix: string): CompletionResult {
    // Remove leading slash for matching
    const cleanPrefix = prefix.startsWith('/') ? prefix.slice(1) : prefix;
    
    const matchingCommands: CompletionItem[] = [];
    
    for (const [command, definition] of this.commands) {
      const commandName = command.slice(1); // Remove leading slash
      
      if (commandName.startsWith(cleanPrefix)) {
        matchingCommands.push({
          value: commandName,
          description: definition.description + (definition.parameters ? ` ${definition.parameters}` : ''),
          type: 'command',
          priority: this.getCommandPriority(command)
        });
      }
    }

    // Sort by priority (higher first) then alphabetically
    matchingCommands.sort((a, b) => {
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.value.localeCompare(b.value);
    });

    return {
      items: matchingCommands,
      prefix: cleanPrefix
    };
  }

  private getCommandPriority(command: string): number {
    // Give higher priority to commonly used commands
    const highPriority = ['/help', '/tools', '/status', '/memory'];
    const mediumPriority = ['/quit', '/clear', '/approval'];
    
    if (highPriority.includes(command)) return 10;
    if (mediumPriority.includes(command)) return 5;
    return 0;
  }

  /**
   * Add a custom command to the completion provider
   */
  addCommand(command: string, description: string, options: { requiresAgent?: boolean; parameters?: string } = {}) {
    if (!command.startsWith('/')) {
      command = '/' + command;
    }
    
    this.commands.set(command, {
      command,
      description,
      requiresAgent: options.requiresAgent,
      parameters: options.parameters
    });
  }

  /**
   * Remove a command from the completion provider
   */
  removeCommand(command: string) {
    if (!command.startsWith('/')) {
      command = '/' + command;
    }
    
    this.commands.delete(command);
  }

  /**
   * Get all available commands
   */
  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }
}