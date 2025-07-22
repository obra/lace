// ABOUTME: Unit tests for CommandExecutor with command parsing and execution flow
// ABOUTME: Tests command parsing, error handling, and UserInterface integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandExecutor } from '~/commands/executor';
import { CommandRegistry } from '~/commands/registry';
import type { Command, UserInterface } from '~/commands/types';
import type { Agent } from '~/agents/agent';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

// Test helper that captures actual command execution behavior
class TestCommand implements Command {
  name: string;
  description: string;
  aliases?: string[];
  executionResults: { args: string; ui: UserInterface }[] = [];
  shouldThrow?: Error;

  constructor(name: string, description = 'Test command', aliases?: string[]) {
    this.name = name;
    this.description = description;
    this.aliases = aliases;
  }

  execute(args: string, ui: UserInterface): void {
    this.executionResults.push({ args, ui });
    if (this.shouldThrow) {
      throw this.shouldThrow;
    }
  }

  // Helper methods for assertions
  wasExecuted(): boolean {
    return this.executionResults.length > 0;
  }

  getLastExecution(): { args: string; ui: UserInterface } | undefined {
    return this.executionResults[this.executionResults.length - 1];
  }

  getAllExecutions(): { args: string; ui: UserInterface }[] {
    return [...this.executionResults];
  }

  reset(): void {
    this.executionResults = [];
    this.shouldThrow = undefined;
  }

  setThrow(error: Error): void {
    this.shouldThrow = error;
  }
}

// Test helper that captures UI interactions
class TestUI implements UserInterface {
  agent: Agent;
  messages: string[] = [];
  exitCalled = false;
  clearSessionCalled = false;

  constructor(agent: Agent) {
    this.agent = agent;
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

  // Helper methods for assertions
  getLastMessage(): string {
    return this.messages[this.messages.length - 1] || '';
  }

  getAllMessages(): string[] {
    return [...this.messages];
  }

  hasMessage(content: string): boolean {
    return this.messages.some((msg) => msg.includes(content));
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  reset(): void {
    this.messages = [];
    this.exitCalled = false;
    this.clearSessionCalled = false;
  }
}

describe('CommandExecutor', () => {
  let registry: CommandRegistry;
  let executor: CommandExecutor;
  let testUI: TestUI;
  let mockAgent: Partial<Agent>;

  beforeEach(() => {
    setupTestPersistence();
    registry = new CommandRegistry();
    executor = new CommandExecutor(registry);

    mockAgent = {
      threadManager: {
        getCurrentThreadId: vi.fn().mockReturnValue('test-thread'),
        generateThreadId: vi.fn().mockReturnValue('new-thread'),
        createThread: vi.fn(),
      },
      providerName: 'test-provider',
    } as Partial<Agent>;

    testUI = new TestUI(mockAgent as Agent);
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('command parsing', () => {
    it('should parse basic commands', () => {
      const result = executor['parseCommand']('/help');
      expect(result).toEqual({
        command: 'help',
        args: '',
        argv: [],
      });
    });

    it('should parse commands with arguments', () => {
      const result = executor['parseCommand']('/test arg1 arg2');
      expect(result).toEqual({
        command: 'test',
        args: 'arg1 arg2',
        argv: ['arg1', 'arg2'],
      });
    });

    it('should handle commands without leading/trailing whitespace', () => {
      const result = executor['parseCommand']('/help');
      expect(result).toEqual({
        command: 'help',
        args: '',
        argv: [],
      });
    });

    it('should handle commands with arguments', () => {
      const result = executor['parseCommand']('/test arg1 arg2');
      expect(result).toEqual({
        command: 'test',
        args: 'arg1 arg2',
        argv: ['arg1', 'arg2'],
      });
    });

    it('should return null for non-slash commands', () => {
      const result = executor['parseCommand']('not a command');
      expect(result).toBeNull();
    });

    it('should return null for empty input', () => {
      const result = executor['parseCommand']('');
      expect(result).toBeNull();
    });

    it('should parse just a slash as empty command', () => {
      const result = executor['parseCommand']('/');
      expect(result).toEqual({
        command: '',
        args: '',
        argv: [],
      });
    });
  });

  describe('command execution', () => {
    it('should execute registered commands', async () => {
      const testCommand = new TestCommand('test');

      registry.register(testCommand);
      await executor.execute('/test', testUI);

      // Test actual behavior - command was executed with correct arguments
      expect(testCommand.wasExecuted()).toBe(true);
      const execution = testCommand.getLastExecution();
      expect(execution?.args).toBe('');
      expect(execution?.ui).toBe(testUI);
    });

    it('should execute commands with arguments', async () => {
      const testCommand = new TestCommand('test');

      registry.register(testCommand);
      await executor.execute('/test arg1 arg2', testUI);

      // Test actual behavior - command was executed with correct arguments
      expect(testCommand.wasExecuted()).toBe(true);
      const execution = testCommand.getLastExecution();
      expect(execution?.args).toBe('arg1 arg2');
      expect(execution?.ui).toBe(testUI);
    });

    it('should handle command aliases', async () => {
      const testCommand = new TestCommand('test', 'Test command', ['t']);

      registry.register(testCommand);
      await executor.execute('/t', testUI);

      // Test actual behavior - command was executed via alias
      expect(testCommand.wasExecuted()).toBe(true);
      const execution = testCommand.getLastExecution();
      expect(execution?.args).toBe('');
      expect(execution?.ui).toBe(testUI);
    });

    it('should display error for unknown commands', async () => {
      await executor.execute('/unknown', testUI);

      // Test actual behavior - error message was displayed
      expect(testUI.hasMessage('Unknown command: unknown')).toBe(true);
      expect(testUI.getLastMessage()).toBe('Unknown command: unknown');
    });

    it('should do nothing for non-slash input', async () => {
      await executor.execute('not a command', testUI);

      // Test actual behavior - no messages were displayed
      expect(testUI.getMessageCount()).toBe(0);
      expect(testUI.getAllMessages()).toEqual([]);
    });

    it('should handle command execution errors', async () => {
      const error = new Error('Command failed');
      const testCommand = new TestCommand('test');
      testCommand.setThrow(error);

      registry.register(testCommand);
      await executor.execute('/test', testUI);

      // Test actual behavior - error message was displayed
      expect(testUI.hasMessage('Command failed: Command failed')).toBe(true);
      expect(testUI.getLastMessage()).toBe('Command failed: Command failed');
    });

    it('should handle commands that throw synchronously', async () => {
      const testCommand = new TestCommand('test');
      testCommand.setThrow(new Error('Sync error'));

      registry.register(testCommand);
      await executor.execute('/test', testUI);

      // Test actual behavior - error message was displayed for sync error
      expect(testUI.hasMessage('Command failed: Sync error')).toBe(true);
      expect(testUI.getLastMessage()).toBe('Command failed: Sync error');
    });
  });

  describe('edge cases', () => {
    it('should handle empty command name after slash', async () => {
      await executor.execute('/', testUI);

      // Test actual behavior - error message for empty command
      expect(testUI.hasMessage('Unknown command: ')).toBe(true);
      expect(testUI.getLastMessage()).toBe('Unknown command: ');
    });

    it('should handle whitespace-only input after slash', async () => {
      await executor.execute('/   ', testUI);

      // Test actual behavior - whitespace treated as empty command
      expect(testUI.hasMessage('Unknown command: ')).toBe(true);
      expect(testUI.getLastMessage()).toBe('Unknown command: ');
    });

    it('should handle commands with no description', async () => {
      const testCommand = new TestCommand('test', ''); // Empty description

      registry.register(testCommand);
      await executor.execute('/test', testUI);

      // Test actual behavior - command still executes despite empty description
      expect(testCommand.wasExecuted()).toBe(true);
      expect(testUI.getMessageCount()).toBe(0); // No error messages
    });

    it('should preserve argument spacing', async () => {
      const testCommand = new TestCommand('test');

      registry.register(testCommand);
      await executor.execute('/test "arg with spaces"', testUI);

      // Test actual behavior - arguments with spaces are preserved
      expect(testCommand.wasExecuted()).toBe(true);
      const execution = testCommand.getLastExecution();
      expect(execution?.args).toBe('"arg with spaces"');
    });

    it('should handle multiple command executions independently', async () => {
      const testCommand1 = new TestCommand('cmd1');
      const testCommand2 = new TestCommand('cmd2');

      registry.register(testCommand1);
      registry.register(testCommand2);

      await executor.execute('/cmd1 arg1', testUI);
      await executor.execute('/cmd2 arg2', testUI);

      // Test actual behavior - both commands executed independently
      expect(testCommand1.wasExecuted()).toBe(true);
      expect(testCommand2.wasExecuted()).toBe(true);
      expect(testCommand1.getLastExecution()?.args).toBe('arg1');
      expect(testCommand2.getLastExecution()?.args).toBe('arg2');
      expect(testUI.getMessageCount()).toBe(0); // No errors
    });

    it('should handle command registry lookup correctly', async () => {
      const testCommand = new TestCommand('registered');
      registry.register(testCommand);

      // Try registered command
      await executor.execute('/registered', testUI);
      expect(testCommand.wasExecuted()).toBe(true);

      // Try unregistered command
      testCommand.reset();
      testUI.reset();
      await executor.execute('/unregistered', testUI);

      // Test actual behavior - registry correctly distinguishes commands
      expect(testCommand.wasExecuted()).toBe(false);
      expect(testUI.hasMessage('Unknown command: unregistered')).toBe(true);
    });

    it('should handle error messages with different error types', async () => {
      const testCommand1 = new TestCommand('error1');
      const testCommand2 = new TestCommand('error2');
      testCommand1.setThrow(new Error('Detailed error'));
      testCommand2.setThrow('String error' as unknown as Error); // Non-Error object

      registry.register(testCommand1);
      registry.register(testCommand2);

      await executor.execute('/error1', testUI);
      await executor.execute('/error2', testUI);

      // Test actual behavior - different error types handled correctly
      expect(testUI.hasMessage('Command failed: Detailed error')).toBe(true);
      expect(testUI.hasMessage('Command failed: String error')).toBe(true);
      expect(testUI.getAllMessages()).toHaveLength(2);
    });
  });

  describe('integration behavior', () => {
    it('should coordinate correctly with command registry', async () => {
      const testCommand = new TestCommand('test');

      // Test behavior before and after registration
      await executor.execute('/test', testUI);
      expect(testUI.hasMessage('Unknown command: test')).toBe(true);

      testUI.reset();
      registry.register(testCommand);
      await executor.execute('/test', testUI);

      // Test actual integration behavior
      expect(testCommand.wasExecuted()).toBe(true);
      expect(testUI.getMessageCount()).toBe(0); // No error messages after registration
    });

    it('should pass correct context to commands', async () => {
      const testCommand = new TestCommand('context');
      registry.register(testCommand);

      await executor.execute('/context test args', testUI);

      // Test actual behavior - correct context passed through
      expect(testCommand.wasExecuted()).toBe(true);
      const execution = testCommand.getLastExecution();
      expect(execution?.ui).toBe(testUI);
      expect(execution?.ui.agent).toBe(mockAgent);
      expect(execution?.args).toBe('test args');
    });

    it('should handle command execution state correctly', async () => {
      const slowCommand = new TestCommand('slow');
      const fastCommand = new TestCommand('fast');

      registry.register(slowCommand);
      registry.register(fastCommand);

      // Execute commands to verify execution state
      await executor.execute('/slow', testUI);
      await executor.execute('/fast', testUI);

      // Test actual behavior - commands completed successfully
      expect(slowCommand.wasExecuted()).toBe(true);
      expect(fastCommand.wasExecuted()).toBe(true);
      expect(testUI.getMessageCount()).toBe(0); // No errors occurred
    });
  });

  describe('argument parsing validation', () => {
    it('should handle complex argument patterns correctly', async () => {
      const testCommand = new TestCommand('args');
      registry.register(testCommand);

      const testCases = [
        { input: '/args', expected: '' },
        { input: '/args single', expected: 'single' },
        { input: '/args multiple words', expected: 'multiple words' },
        { input: '/args   extra   spaces   ', expected: '  extra   spaces   ' },
        { input: '/args "quoted string"', expected: '"quoted string"' },
        { input: '/args --flag value', expected: '--flag value' },
      ];

      for (const testCase of testCases) {
        testCommand.reset();
        await executor.execute(testCase.input, testUI);

        // Test actual parsing behavior
        expect(testCommand.wasExecuted()).toBe(true);
        expect(testCommand.getLastExecution()?.args).toBe(testCase.expected);
      }
    });
  });
});
