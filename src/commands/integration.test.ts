// ABOUTME: Integration tests for command system auto-discovery and execution
// ABOUTME: Tests the full flow from registry creation to command execution

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandRegistry } from '~/commands/registry';
import { CommandExecutor } from '~/commands/executor';
import type { UserInterface } from '~/commands/types';
import type { Agent } from '~/agents/agent';

type MockAgent = {
  getCurrentThreadId: () => string;
  generateThreadId: () => string;
  createThread: () => void;
  compact: (threadId: string) => void;
  getThreadEvents: () => unknown[];
  providerName: string;
  toolExecutor: {
    getAllTools: () => unknown[];
  };
  threadManager: {
    getCurrentThreadId: () => string;
    generateThreadId: () => string;
    createThread: () => void;
    compact: () => void;
    getEvents: () => unknown[];
  };
};

// Test helper for capturing command system integration behavior
class TestUI implements UserInterface {
  agent: Agent;
  messages: string[] = [];
  exitCalled = false;
  clearSessionCalled = false;
  commandExecutionResults: {
    lastCommandName?: string;
    executionSuccess: boolean;
  } = { executionSuccess: false };

  constructor(agent: MockAgent) {
    this.agent = agent as unknown as Agent;
  }

  displayMessage(message: string): void {
    this.messages.push(message);
  }

  clearSession(): void {
    this.clearSessionCalled = true;
  }

  exit(): void {
    this.exitCalled = true;
  }

  // Helper methods for integration testing
  getLastMessage(): string {
    return this.messages[this.messages.length - 1] || '';
  }

  getAllMessages(): string[] {
    return [...this.messages];
  }

  hasMessage(content: string): boolean {
    return this.messages.some((msg) => msg.includes(content));
  }

  getCommandResults() {
    return {
      helpDisplayed: this.hasMessage('Available commands:'),
      statusDisplayed: this.hasMessage('Provider:'),
      unknownCommandError: this.hasMessage('Unknown command:'),
      exitTriggered: this.exitCalled,
      sessionCleared: this.clearSessionCalled,
    };
  }

  reset(): void {
    this.messages = [];
    this.exitCalled = false;
    this.clearSessionCalled = false;
    this.commandExecutionResults = { executionSuccess: false };
  }
}

describe('Command System Integration', () => {
  let testUI: TestUI;
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = {
      // Agent API methods (new structure)
      getCurrentThreadId: vi.fn().mockReturnValue('test-thread'),
      generateThreadId: vi.fn().mockReturnValue('new-thread'),
      createThread: vi.fn(),
      compact: vi.fn(),
      getThreadEvents: vi.fn().mockReturnValue([]),
      providerName: 'test-provider',
      toolExecutor: {
        getAllTools: vi.fn().mockReturnValue([]),
      },
      // ThreadManager for legacy compatibility in some tests
      threadManager: {
        getCurrentThreadId: vi.fn().mockReturnValue('test-thread'),
        generateThreadId: vi.fn().mockReturnValue('new-thread'),
        createThread: vi.fn(),
        compact: vi.fn(),
        getEvents: vi.fn().mockReturnValue([]),
      },
    } as MockAgent;

    testUI = new TestUI(mockAgent);
  });

  describe('auto-discovery and execution', () => {
    it('should auto-discover system commands and execute them', async () => {
      // Create registry with auto-discovery
      const registry = await CommandRegistry.createWithAutoDiscovery();
      new CommandExecutor(registry);

      // Verify commands are discovered
      const commands = registry.getAllCommands();
      expect(commands.length).toBeGreaterThan(0);

      // Should find all system commands
      const commandNames = commands.map((cmd) => cmd.name).sort();
      expect(commandNames).toContain('help');
      expect(commandNames).toContain('exit');
      expect(commandNames).toContain('clear');
      expect(commandNames).toContain('status');
      expect(commandNames).toContain('compact');
    });

    it('should execute help command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute help command
      await executor.execute('/help', testUI);

      // Test actual behavior - help was displayed with command list
      const results = testUI.getCommandResults();
      expect(results.helpDisplayed).toBe(true);
      expect(testUI.hasMessage('Available commands:')).toBe(true);
    });

    it('should execute status command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute status command
      await executor.execute('/status', testUI);

      // Test actual behavior - status information was displayed
      const results = testUI.getCommandResults();
      expect(results.statusDisplayed).toBe(true);
      expect(testUI.hasMessage('Provider: test-provider')).toBe(true);
    });

    it('should execute exit command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute exit command
      await executor.execute('/exit', testUI);

      // Test actual behavior - application exit was triggered
      const results = testUI.getCommandResults();
      expect(results.exitTriggered).toBe(true);
    });

    it('should execute clear command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute clear command
      await executor.execute('/clear', testUI);

      // Test actual behavior - session was cleared
      const results = testUI.getCommandResults();
      expect(results.sessionCleared).toBe(true);
    });

    it('should handle unknown commands gracefully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute unknown command
      await executor.execute('/unknown', testUI);

      // Test actual behavior - unknown command error displayed
      const results = testUI.getCommandResults();
      expect(results.unknownCommandError).toBe(true);
      expect(testUI.hasMessage('Unknown command: unknown')).toBe(true);
    });

    it('should handle non-slash input gracefully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute non-slash input
      await executor.execute('not a command', testUI);

      // Test actual behavior - no command processing occurred
      expect(testUI.messages).toHaveLength(0);
      expect(testUI.exitCalled).toBe(false);
      expect(testUI.clearSessionCalled).toBe(false);
    });
  });

  describe('help command functionality', () => {
    it('should show specific command help when argument provided', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute help with specific command
      await executor.execute('/help exit', testUI);

      // Test actual behavior - specific command help was displayed
      expect(testUI.hasMessage('/exit - Exit the application')).toBe(true);
      expect(testUI.messages).toHaveLength(1);
    });

    it('should show unknown command error for invalid help argument', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute help with unknown command
      await executor.execute('/help unknown', testUI);

      // Test actual behavior - error message displayed for invalid help argument
      expect(testUI.hasMessage('Unknown command: unknown')).toBe(true);
      const results = testUI.getCommandResults();
      expect(results.unknownCommandError).toBe(true);
    });
  });
});
