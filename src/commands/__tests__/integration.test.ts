// ABOUTME: Integration tests for command system auto-discovery and execution
// ABOUTME: Tests the full flow from registry creation to command execution

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandRegistry } from '~/commands/registry.js';
import { CommandExecutor } from '~/commands/executor.js';
import type { UserInterface } from '~/commands/types.js';

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

describe('Command System Integration', () => {
  let mockUI: UserInterface;
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

    mockUI = {
      agent: mockAgent as any,
      displayMessage: vi.fn(),
      clearSession: vi.fn(),
      exit: vi.fn(),
    } as UserInterface;
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
      await executor.execute('/help', mockUI);

      // Should display help message
      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Available commands:')
      );
    });

    it('should execute status command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute status command
      await executor.execute('/status', mockUI);

      // Should display status information
      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        expect.stringContaining('Provider: test-provider')
      );
    });

    it('should execute exit command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute exit command
      await executor.execute('/exit', mockUI);

      // Should call UI exit method
      expect(mockUI.exit).toHaveBeenCalled();
    });

    it('should execute clear command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute clear command
      await executor.execute('/clear', mockUI);

      // Should call UI clearSession method
      expect(mockUI.clearSession).toHaveBeenCalled();
    });

    it('should execute compact command successfully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute compact command
      await executor.execute('/compact', mockUI);

      // Should call agent compact (new API)
      expect(mockAgent.compact).toHaveBeenCalledWith('test-thread');
    });

    it('should handle unknown commands gracefully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute unknown command
      await executor.execute('/unknown', mockUI);

      // Should display error message
      expect(mockUI.displayMessage).toHaveBeenCalledWith('Unknown command: unknown');
    });

    it('should handle non-slash input gracefully', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute non-slash input
      await executor.execute('not a command', mockUI);

      // Should not call displayMessage
      expect(mockUI.displayMessage).not.toHaveBeenCalled();
    });
  });

  describe('help command functionality', () => {
    it('should show specific command help when argument provided', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute help with specific command
      await executor.execute('/help exit', mockUI);

      // Should show specific command help
      expect(mockUI.displayMessage).toHaveBeenCalledWith('/exit - Exit the application');
    });

    it('should show unknown command error for invalid help argument', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      const executor = new CommandExecutor(registry);

      // Execute help with unknown command
      await executor.execute('/help unknown', mockUI);

      // Should show error
      expect(mockUI.displayMessage).toHaveBeenCalledWith('Unknown command: unknown');
    });
  });
});
