// ABOUTME: Type definitions for the command system
// ABOUTME: Defines interfaces for commands, results, and execution context

export interface CommandContext {
  laceUI: any; // LaceUI instance
  agent?: any; // Current agent
  setConversation?: (updater: (prev: any[]) => any[]) => void;
  addMessage?: (message: any) => void;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  shouldExit?: boolean;
  shouldShowModal?: {
    type: 'status' | 'tools' | 'memory' | 'approval' | 'help' | 'activity';
    data: any;
  };
}

export interface Command {
  name: string;
  description: string;
  handler: (args: string[], context: CommandContext) => Promise<CommandResult> | CommandResult;
  requiresAgent?: boolean;
  hidden?: boolean;
  parameterDescription?: string;
  aliases?: string[];
}

export interface CommandRegistry {
  [key: string]: Command;
}

export interface CommandCompletion {
  value: string;
  description: string;
  type: 'command';
  hasParameters?: boolean;
  parameterDescription?: string;
}