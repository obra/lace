// ABOUTME: Unit tests for all system commands (help, exit, clear, status, queue)
// ABOUTME: Tests command behavior and output rather than mock interactions

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { createHelpCommand } from '~/commands/system/help';
import { exitCommand } from '~/commands/system/exit';
import { clearCommand } from '~/commands/system/clear';
import { statusCommand } from '~/commands/system/status';
import { queueCommand } from '~/commands/system/queue';
import { CommandRegistry } from '~/commands/registry';
import type { UserInterface, Command } from '~/commands/types';
import type { Agent } from '~/agents/agent';

type MockAgent = {
  getThreadId: MockedFunction<() => string>;
  generateThreadId: MockedFunction<() => string>;
  createThread: MockedFunction<() => void>;
  getThreadEvents: MockedFunction<(threadId: string) => Array<{ type: string; data: string }>>;
  providerName: string;
  getQueueStats: MockedFunction<() => { queueLength: number; highPriorityCount: number }>;
  getQueueContents: MockedFunction<() => unknown[]>;
  clearQueue: MockedFunction<() => number>;
  toolExecutor: {
    getAllTools: MockedFunction<() => unknown[]>;
  };
};

// Test helpers for capturing behavior instead of mocking interactions
class TestUI implements UserInterface {
  agent: Agent;
  messages: string[] = [];
  exitCalled = false;
  clearSessionCalled = false;

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

  reset(): void {
    this.messages = [];
    this.exitCalled = false;
    this.clearSessionCalled = false;
  }
}

describe('System Commands', () => {
  let testUI: TestUI;
  let mockAgent: MockAgent;
  let registry: CommandRegistry;
  let helpCommand: Command;

  beforeEach(() => {
    registry = new CommandRegistry();
    // Register some test commands so help has something to show
    registry.register(exitCommand);
    registry.register(clearCommand);
    helpCommand = createHelpCommand(registry);

    mockAgent = {
      // Agent API methods
      getThreadId: vi.fn().mockReturnValue('test-thread-123'),
      generateThreadId: vi.fn().mockReturnValue('new-thread-456'),
      createThread: vi.fn(),
      getThreadEvents: vi.fn().mockReturnValue([
        {
          type: 'LOCAL_SYSTEM_MESSAGE',
          data: 'Test system message',
        },
      ]),
      providerName: 'test-provider',
      // Queue methods for queue command
      getQueueStats: vi.fn().mockReturnValue({
        queueLength: 0,
        highPriorityCount: 0,
      }),
      getQueueContents: vi.fn().mockReturnValue([]),
      clearQueue: vi.fn().mockReturnValue(0),
      // Mock tool executor
      toolExecutor: {
        getAllTools: vi.fn().mockReturnValue([]),
      },
    } as MockAgent;

    testUI = new TestUI(mockAgent);
  });

  describe('helpCommand', () => {
    it('should have correct metadata', () => {
      expect(helpCommand.name).toBe('help');
      expect(helpCommand.description).toBe('Show available commands');
      expect(typeof helpCommand.execute).toBe('function');
    });

    it('should display help message with available commands', async () => {
      await helpCommand.execute('', testUI);

      // Test actual behavior - help message was displayed
      expect(testUI.hasMessage('Available commands:')).toBe(true);
      expect(testUI.messages.length).toBeGreaterThan(0);
    });

    it('should show specific command help when args provided', async () => {
      await helpCommand.execute('exit', testUI);

      // Test actual behavior - specific help was shown
      expect(testUI.hasMessage('/exit - Exit the application')).toBe(true);
    });
  });

  describe('exitCommand', () => {
    it('should have correct metadata', () => {
      expect(exitCommand.name).toBe('exit');
      expect(exitCommand.description).toBe('Exit the application');
      expect(typeof exitCommand.execute).toBe('function');
    });

    it('should terminate the application', async () => {
      await exitCommand.execute('', testUI);

      // Test actual behavior - application was terminated
      expect(testUI.exitCalled).toBe(true);
    });

    it('should ignore arguments and still exit', async () => {
      await exitCommand.execute('some args', testUI);

      // Test actual behavior - exit still happened regardless of args
      expect(testUI.exitCalled).toBe(true);
    });
  });

  describe('clearCommand', () => {
    it('should have correct metadata', () => {
      expect(clearCommand.name).toBe('clear');
      expect(clearCommand.description).toBe('Clear conversation back to system prompt');
      expect(typeof clearCommand.execute).toBe('function');
    });

    it('should clear the conversation session', async () => {
      await clearCommand.execute('', testUI);

      // Test actual behavior - session was cleared
      expect(testUI.clearSessionCalled).toBe(true);
    });

    it('should ignore arguments and still clear', async () => {
      await clearCommand.execute('some args', testUI);

      // Test actual behavior - clear still happened regardless of args
      expect(testUI.clearSessionCalled).toBe(true);
    });
  });

  describe('statusCommand', () => {
    it('should have correct metadata', () => {
      expect(statusCommand.name).toBe('status');
      expect(statusCommand.description).toBe('Show current status');
      expect(typeof statusCommand.execute).toBe('function');
    });

    it('should display comprehensive session status', async () => {
      await statusCommand.execute('', testUI);

      // Test actual behavior - status information was displayed
      expect(testUI.hasMessage('Provider: test-provider')).toBe(true);
      expect(testUI.hasMessage('Thread: test-thread-123')).toBe(true);
      expect(testUI.hasMessage('Tools: 0 available')).toBe(true);
    });

    it('should handle missing thread ID gracefully', async () => {
      mockAgent.getThreadId.mockReturnValue('');

      await statusCommand.execute('', testUI);

      // Test actual behavior - proper handling of missing thread
      expect(testUI.hasMessage('Thread: none')).toBe(true);
    });

    it('should ignore arguments and show status', async () => {
      await statusCommand.execute('some args', testUI);

      // Test actual behavior - status shown regardless of args
      expect(testUI.hasMessage('Provider: test-provider')).toBe(true);
    });
  });

  describe('queueCommand', () => {
    it('should have correct metadata', () => {
      expect(queueCommand.name).toBe('queue');
      expect(queueCommand.description).toBe('View message queue or clear queued messages');
      expect(typeof queueCommand.execute).toBe('function');
    });

    it('should display empty queue status', async () => {
      await queueCommand.execute('', testUI);

      // Test actual behavior - empty queue message displayed
      expect(testUI.hasMessage('📬 Message queue is empty')).toBe(true);
    });

    it('should handle queue clearing with feedback', async () => {
      mockAgent.clearQueue.mockReturnValue(2);

      await queueCommand.execute('clear', testUI);

      // Test actual behavior - clear operation performed and user informed
      expect(testUI.hasMessage('📬 Cleared 2 user messages from queue')).toBe(true);
      // Clear message confirms the queue clearing operation was executed successfully
    });
  });

  describe('command structure validation', () => {
    it('should have all required fields for each command', () => {
      const commands = [helpCommand, exitCommand, clearCommand, statusCommand, queueCommand];

      commands.forEach((command) => {
        expect(command.name).toBeDefined();
        expect(typeof command.name).toBe('string');
        expect(command.name.length).toBeGreaterThan(0);

        expect(command.description).toBeDefined();
        expect(typeof command.description).toBe('string');
        expect(command.description.length).toBeGreaterThan(0);

        expect(command.execute).toBeDefined();
        expect(typeof command.execute).toBe('function');
      });
    });

    it('should have unique command names', () => {
      const commands = [helpCommand, exitCommand, clearCommand, statusCommand, queueCommand];
      const names = commands.map((cmd) => cmd.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should not have aliases defined (per YAGNI)', () => {
      const commands = [helpCommand, exitCommand, clearCommand, statusCommand, queueCommand];
      commands.forEach((command) => {
        expect(command.aliases).toBeUndefined();
      });
    });
  });
});
