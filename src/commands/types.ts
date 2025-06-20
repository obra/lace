// ABOUTME: Core interfaces for the extensible command system
// ABOUTME: Defines UserInterface abstraction and Command interface for interface-agnostic commands

import type { Agent } from '../agents/agent.js';

/**
 * Minimal interface that commands work against
 * Abstracts away interface-specific details (terminal, CLI, web, etc.)
 */
export interface UserInterface {
  // Core state - agent contains threadManager and toolExecutor
  agent: Agent;

  // Simple command interface
  displayMessage(message: string): void;
  clearSession(): void; // Recreate agent + thread
  exit(): void;
}

/**
 * Interface for all commands (system and user-defined)
 * Commands are pure business logic, interface-agnostic
 */
export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute(args: string, ui: UserInterface): Promise<void>;
}

/**
 * Parsed command structure
 */
export interface ParsedCommand {
  command: string;
  args: string;
  argv: string[];
}
