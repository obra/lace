// ABOUTME: Tests for CommandManager - command registration, parsing, and execution
// ABOUTME: Validates command system core functionality with mock dependencies

import { jest } from '@jest/globals';
import { CommandManager } from '@/ui/commands/CommandManager';
import type { Command, CommandContext, CommandResult } from '@/ui/commands/types';

describe('CommandManager', () => {
  let commandManager: CommandManager;
  let mockContext: CommandContext;

  beforeEach(() => {
    commandManager = new CommandManager();
    mockContext = {
      laceUI: {
        handleAbort: jest.fn(),
        getStatus: jest.fn()
      },
      agent: {
        tools: {
          listTools: jest.fn(() => ['file', 'shell'])
        }
      },
      addMessage: jest.fn()
    };
  });

  describe('command registration', () => {
    it('should register a command', () => {
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        handler: () => ({ success: true })
      };

      commandManager.register(testCommand);
      expect(commandManager.hasCommand('test')).toBe(true);
    });

    it('should register multiple commands', () => {
      const commands: Command[] = [
        { name: 'cmd1', description: 'Command 1', handler: () => ({ success: true }) },
        { name: 'cmd2', description: 'Command 2', handler: () => ({ success: true }) }
      ];

      commandManager.registerAll(commands);
      expect(commandManager.hasCommand('cmd1')).toBe(true);
      expect(commandManager.hasCommand('cmd2')).toBe(true);
    });

    it('should handle command aliases', () => {
      const command: Command = {
        name: 'quit',
        description: 'Exit application',
        aliases: ['exit', 'q'],
        handler: () => ({ success: true, shouldExit: true })
      };

      commandManager.register(command);
      expect(commandManager.hasCommand('quit')).toBe(true);
      expect(commandManager.hasCommand('exit')).toBe(true);
      expect(commandManager.hasCommand('q')).toBe(true);
    });
  });

  describe('command parsing', () => {
    it('should identify command input', () => {
      expect(commandManager.isCommand('/help')).toBe(true);
      expect(commandManager.isCommand('/status')).toBe(true);
      expect(commandManager.isCommand('regular message')).toBe(false);
      expect(commandManager.isCommand('')).toBe(false);
    });

    it('should parse command with arguments', () => {
      const result = commandManager.parseCommand('/auto-approve file shell');
      expect(result).toEqual({
        command: 'auto-approve',
        args: ['file', 'shell']
      });
    });

    it('should parse command without arguments', () => {
      const result = commandManager.parseCommand('/help');
      expect(result).toEqual({
        command: 'help',
        args: []
      });
    });

    it('should handle empty command gracefully', () => {
      const result = commandManager.parseCommand('/');
      expect(result).toEqual({
        command: '',
        args: []
      });
    });
  });

  describe('command execution', () => {
    beforeEach(() => {
      // Register test commands
      commandManager.register({
        name: 'simple',
        description: 'Simple test command',
        handler: () => ({ success: true, message: 'Simple command executed' })
      });

      commandManager.register({
        name: 'async',
        description: 'Async test command',
        handler: async (args) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { success: true, message: `Async command with ${args.length} args` };
        }
      });

      commandManager.register({
        name: 'agent-required',
        description: 'Requires agent',
        requiresAgent: true,
        handler: () => ({ success: true, message: 'Agent command executed' })
      });

      commandManager.register({
        name: 'failing',
        description: 'Always fails',
        handler: () => ({ success: false, message: 'Command failed' })
      });
    });

    it('should execute simple command', async () => {
      const result = await commandManager.execute('/simple', mockContext);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Simple command executed');
    });

    it('should execute async command', async () => {
      jest.useRealTimers(); // Use real timers for this async test
      const result = await commandManager.execute('/async arg1 arg2', mockContext);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Async command with 2 args');
      jest.useFakeTimers(); // Restore fake timers
    });

    it('should handle unknown commands', async () => {
      const result = await commandManager.execute('/unknown', mockContext);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command: unknown');
    });

    it('should check agent requirement', async () => {
      const contextWithoutAgent = { ...mockContext, agent: undefined };
      const result = await commandManager.execute('/agent-required', contextWithoutAgent);
      expect(result.success).toBe(false);
      expect(result.message).toContain('No agent available');
    });

    it('should execute command that requires agent', async () => {
      const result = await commandManager.execute('/agent-required', mockContext);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Agent command executed');
    });

    it('should handle command execution errors', async () => {
      commandManager.register({
        name: 'error',
        description: 'Throws error',
        handler: () => {
          throw new Error('Test error');
        }
      });

      const result = await commandManager.execute('/error', mockContext);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Test error');
    });
  });

  describe('command listing and completion', () => {
    beforeEach(() => {
      commandManager.registerAll([
        {
          name: 'help',
          description: 'Show help',
          handler: () => ({ success: true })
        },
        {
          name: 'status',
          description: 'Show status',
          requiresAgent: true,
          handler: () => ({ success: true })
        },
        {
          name: 'hidden-cmd',
          description: 'Hidden command',
          hidden: true,
          handler: () => ({ success: true })
        }
      ]);
    });

    it('should list all non-hidden commands', () => {
      const commands = commandManager.listCommands();
      expect(commands).toHaveLength(2);
      expect(commands.map(c => c.name)).toContain('help');
      expect(commands.map(c => c.name)).toContain('status');
      expect(commands.map(c => c.name)).not.toContain('hidden-cmd');
    });

    it('should list all commands including hidden when requested', () => {
      const commands = commandManager.listCommands(true);
      expect(commands).toHaveLength(3);
      expect(commands.map(c => c.name)).toContain('hidden-cmd');
    });

    it('should get command completions', () => {
      const completions = commandManager.getCompletions('h');
      expect(completions).toHaveLength(1);
      expect(completions[0].value).toBe('help');
      expect(completions[0].description).toBe('Show help');
    });

    it('should get all completions for empty prefix', () => {
      const completions = commandManager.getCompletions('');
      expect(completions).toHaveLength(2); // help and status, not hidden
    });
  });
});