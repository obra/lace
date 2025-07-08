// ABOUTME: Unit tests for all system commands (help, exit, clear, status, compact)
// ABOUTME: Tests individual command functionality and UserInterface integration

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHelpCommand } from '../help.js';
import { exitCommand } from '../exit.js';
import { clearCommand } from '../clear.js';
import { statusCommand } from '../status.js';
import { compactCommand } from '../compact.js';
import { queueCommand } from '../queue.js';
import { CommandRegistry } from '../../registry.js';
import type { UserInterface } from '../../types.js';

describe('System Commands', () => {
  let mockUI: UserInterface;
  let mockAgent: any;
  let registry: CommandRegistry;
  let helpCommand: any;

  beforeEach(() => {
    registry = new CommandRegistry();
    // Register some test commands so help has something to show
    registry.register(exitCommand);
    registry.register(clearCommand);
    helpCommand = createHelpCommand(registry);

    mockAgent = {
      // Agent API methods
      getCurrentThreadId: vi.fn().mockReturnValue('test-thread-123'),
      generateThreadId: vi.fn().mockReturnValue('new-thread-456'),
      createThread: vi.fn(),
      compact: vi.fn(),
      getThreadEvents: vi.fn().mockReturnValue([
        {
          type: 'LOCAL_SYSTEM_MESSAGE',
          data: 'Compacted 5 tool results to save tokens',
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
    };

    mockUI = {
      agent: mockAgent,
      displayMessage: vi.fn(),
      clearSession: vi.fn(),
      exit: vi.fn(),
    };
  });

  describe('helpCommand', () => {
    it('should have correct metadata', () => {
      expect(helpCommand.name).toBe('help');
      expect(helpCommand.description).toBe('Show available commands');
      expect(typeof helpCommand.execute).toBe('function');
    });

    it('should display help message', async () => {
      await helpCommand.execute('', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Available commands:')
      );
    });

    it('should show specific command help when args provided', async () => {
      await helpCommand.execute('exit', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('/exit - Exit the application');
    });
  });

  describe('exitCommand', () => {
    it('should have correct metadata', () => {
      expect(exitCommand.name).toBe('exit');
      expect(exitCommand.description).toBe('Exit the application');
      expect(typeof exitCommand.execute).toBe('function');
    });

    it('should call UI exit method', async () => {
      await exitCommand.execute('', mockUI);

      expect(mockUI.exit).toHaveBeenCalled();
    });

    it('should ignore arguments', async () => {
      await exitCommand.execute('some args', mockUI);

      expect(mockUI.exit).toHaveBeenCalled();
    });
  });

  describe('clearCommand', () => {
    it('should have correct metadata', () => {
      expect(clearCommand.name).toBe('clear');
      expect(clearCommand.description).toBe('Clear conversation back to system prompt');
      expect(typeof clearCommand.execute).toBe('function');
    });

    it('should call UI clearSession method', async () => {
      await clearCommand.execute('', mockUI);

      expect(mockUI.clearSession).toHaveBeenCalled();
    });

    it('should ignore arguments', async () => {
      await clearCommand.execute('some args', mockUI);

      expect(mockUI.clearSession).toHaveBeenCalled();
    });
  });

  describe('statusCommand', () => {
    it('should have correct metadata', () => {
      expect(statusCommand.name).toBe('status');
      expect(statusCommand.description).toBe('Show current status');
      expect(typeof statusCommand.execute).toBe('function');
    });

    it('should display session status', async () => {
      await statusCommand.execute('', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Provider: test-provider')
      );
      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Thread: test-thread-123')
      );
      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Tools: 0 available')
      );
    });

    it('should handle missing thread ID', async () => {
      mockAgent.getCurrentThreadId.mockReturnValue(null);

      await statusCommand.execute('', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith(expect.stringContaining('Thread: none'));
    });

    it('should ignore arguments', async () => {
      await statusCommand.execute('some args', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Provider: test-provider')
      );
    });
  });

  describe('compactCommand', () => {
    it('should have correct metadata', () => {
      expect(compactCommand.name).toBe('compact');
      expect(compactCommand.description).toBe('Compress thread history to save tokens');
      expect(typeof compactCommand.execute).toBe('function');
    });

    it('should compact current thread and show message', async () => {
      await compactCommand.execute('', mockUI);

      expect(mockAgent.compact).toHaveBeenCalledWith('test-thread-123');
      expect(mockAgent.getThreadEvents).toHaveBeenCalledWith('test-thread-123');
      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        '✅ Compacted 5 tool results to save tokens'
      );
    });

    it('should handle no active thread', async () => {
      mockAgent.getCurrentThreadId.mockReturnValue(null);

      await compactCommand.execute('', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('❌ No active thread to compact');
      expect(mockAgent.compact).not.toHaveBeenCalled();
    });

    it('should handle compact with no system message', async () => {
      mockAgent.getThreadEvents.mockReturnValue([]);

      await compactCommand.execute('', mockUI);

      expect(mockAgent.compact).toHaveBeenCalledWith('test-thread-123');
      expect(mockUI.displayMessage).toHaveBeenCalledWith('✅ Compacted thread test-thread-123');
    });

    it('should handle events without system message', async () => {
      mockAgent.getThreadEvents.mockReturnValue([
        { type: 'USER_MESSAGE', data: 'Hello' },
        { type: 'AGENT_MESSAGE', data: 'Hi there' },
      ]);

      await compactCommand.execute('', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('✅ Compacted thread test-thread-123');
    });

    it('should ignore arguments', async () => {
      await compactCommand.execute('some args', mockUI);

      expect(mockAgent.compact).toHaveBeenCalledWith('test-thread-123');
    });
  });

  describe('queueCommand', () => {
    it('should have correct metadata', () => {
      expect(queueCommand.name).toBe('queue');
      expect(queueCommand.description).toBe('View message queue or clear queued messages');
      expect(typeof queueCommand.execute).toBe('function');
    });

    it('should handle empty queue', async () => {
      await queueCommand.execute('', mockUI);
      
      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Message queue is empty');
    });

    it('should handle queue clearing', async () => {
      mockAgent.clearQueue.mockReturnValue(2);
      
      await queueCommand.execute('clear', mockUI);
      
      expect(mockAgent.clearQueue).toHaveBeenCalled();
      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Cleared 2 user messages from queue');
    });
  });

  describe('command structure validation', () => {
    it('should have all required fields for each command', () => {
      const commands = [helpCommand, exitCommand, clearCommand, statusCommand, compactCommand, queueCommand];

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
      const commands = [helpCommand, exitCommand, clearCommand, statusCommand, compactCommand, queueCommand];
      const names = commands.map((cmd) => cmd.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should not have aliases defined (per YAGNI)', () => {
      const commands = [helpCommand, exitCommand, clearCommand, statusCommand, compactCommand, queueCommand];
      commands.forEach((command) => {
        expect(command.aliases).toBeUndefined();
      });
    });
  });
});
