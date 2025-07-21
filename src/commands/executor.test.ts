// ABOUTME: Unit tests for CommandExecutor with command parsing and execution flow
// ABOUTME: Tests command parsing, error handling, and UserInterface integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandExecutor } from '~/commands/executor';
import { CommandRegistry } from '~/commands/registry';
import type { Command, UserInterface } from '~/commands/types';
import type { Agent } from '~/agents/agent';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

describe('CommandExecutor', () => {
  let registry: CommandRegistry;
  let executor: CommandExecutor;
  let mockUI: UserInterface;
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

    mockUI = {
      agent: mockAgent as Agent,
      displayMessage: vi.fn(),
      clearSession: vi.fn(),
      exit: vi.fn(),
    } as UserInterface;
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
      const mockExecute = vi.fn();
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        execute: mockExecute,
      };

      registry.register(testCommand);
      await executor.execute('/test', mockUI);

      expect(mockExecute).toHaveBeenCalledWith('', mockUI);
    });

    it('should execute commands with arguments', async () => {
      const mockExecute = vi.fn();
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        execute: mockExecute,
      };

      registry.register(testCommand);
      await executor.execute('/test arg1 arg2', mockUI);

      expect(mockExecute).toHaveBeenCalledWith('arg1 arg2', mockUI);
    });

    it('should handle command aliases', async () => {
      const mockExecute = vi.fn();
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        aliases: ['t'],
        execute: mockExecute,
      };

      registry.register(testCommand);
      await executor.execute('/t', mockUI);

      expect(mockExecute).toHaveBeenCalledWith('', mockUI);
    });

    it('should display error for unknown commands', async () => {
      await executor.execute('/unknown', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('Unknown command: unknown');
    });

    it('should do nothing for non-slash input', async () => {
      await executor.execute('not a command', mockUI);

      expect(mockUI.displayMessage).not.toHaveBeenCalled();
    });

    it('should handle command execution errors', async () => {
      const error = new Error('Command failed');
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        execute: vi.fn().mockRejectedValue(error),
      };

      registry.register(testCommand);
      await executor.execute('/test', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('Command failed: Command failed');
    });

    it('should handle commands that throw synchronously', async () => {
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        execute: vi.fn().mockImplementation(() => {
          throw new Error('Sync error');
        }),
      };

      registry.register(testCommand);
      await executor.execute('/test', mockUI);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('Command failed: Sync error');
    });
  });

  describe('edge cases', () => {
    it('should handle empty command name after slash', async () => {
      await executor.execute('/', mockUI);
      expect(mockUI.displayMessage).toHaveBeenCalledWith('Unknown command: ');
    });

    it('should handle whitespace-only input after slash', async () => {
      await executor.execute('/   ', mockUI);
      expect(mockUI.displayMessage).toHaveBeenCalledWith('Unknown command: ');
    });

    it('should handle commands with no description', async () => {
      const testCommand: Command = {
        name: 'test',
        description: '',
        execute: vi.fn(),
      };

      registry.register(testCommand);
      await executor.execute('/test', mockUI);

      expect(testCommand.execute).toHaveBeenCalled();
    });

    it('should preserve argument spacing', async () => {
      const mockExecute = vi.fn();
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        execute: mockExecute,
      };

      registry.register(testCommand);
      await executor.execute('/test "arg with spaces"', mockUI);

      expect(mockExecute).toHaveBeenCalledWith('"arg with spaces"', mockUI);
    });
  });
});
