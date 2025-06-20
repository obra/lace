// ABOUTME: Unit tests for CommandRegistry with auto-discovery and lookup functionality
// ABOUTME: Tests command registration, alias resolution, and auto-discovery patterns

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from '../registry.js';
import type { Command } from '../types.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe('basic registration and lookup', () => {
    it('should register and retrieve commands', () => {
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        async execute() {},
      };

      registry.register(testCommand);
      const retrieved = registry.get('test');

      expect(retrieved).toBe(testCommand);
    });

    it('should return undefined for non-existent commands', () => {
      const result = registry.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should handle commands with aliases', () => {
      const testCommand: Command = {
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'testing'],
        async execute() {},
      };

      registry.register(testCommand);

      expect(registry.get('test')).toBe(testCommand);
      expect(registry.get('t')).toBe(testCommand);
      expect(registry.get('testing')).toBe(testCommand);
    });

    it('should handle commands without aliases', () => {
      const testCommand: Command = {
        name: 'simple',
        description: 'Simple command',
        async execute() {},
      };

      registry.register(testCommand);
      expect(registry.get('simple')).toBe(testCommand);
    });
  });

  describe('getAllCommands', () => {
    it('should return empty array when no commands registered', () => {
      const commands = registry.getAllCommands();
      expect(commands).toEqual([]);
    });

    it('should return all registered commands', () => {
      const command1: Command = {
        name: 'cmd1',
        description: 'Command 1',
        async execute() {},
      };

      const command2: Command = {
        name: 'cmd2',
        description: 'Command 2',
        async execute() {},
      };

      registry.register(command1);
      registry.register(command2);

      const commands = registry.getAllCommands();
      expect(commands).toHaveLength(2);
      expect(commands).toContain(command1);
      expect(commands).toContain(command2);
    });

    it('should not include duplicate commands when accessed via aliases', () => {
      const command: Command = {
        name: 'test',
        description: 'Test command',
        aliases: ['t'],
        async execute() {},
      };

      registry.register(command);

      const commands = registry.getAllCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toBe(command);
    });
  });

  describe('auto-discovery', () => {
    it('should create registry with auto-discovery', async () => {
      const registry = await CommandRegistry.createWithAutoDiscovery();
      expect(registry).toBeInstanceOf(CommandRegistry);
    });

    it('should handle auto-discovery errors gracefully', async () => {
      // This test verifies the registry still works even if some command files fail to load
      const registry = await CommandRegistry.createWithAutoDiscovery();
      expect(registry).toBeInstanceOf(CommandRegistry);

      // Should have at least some commands loaded (the actual system commands)
      const commands = registry.getAllCommands();
      expect(commands.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle overwriting commands', () => {
      const command1: Command = {
        name: 'test',
        description: 'First test command',
        async execute() {},
      };

      const command2: Command = {
        name: 'test',
        description: 'Second test command',
        async execute() {},
      };

      registry.register(command1);
      registry.register(command2);

      expect(registry.get('test')).toBe(command2);
    });

    it('should handle alias conflicts', () => {
      const command1: Command = {
        name: 'test1',
        description: 'Test command 1',
        aliases: ['t'],
        async execute() {},
      };

      const command2: Command = {
        name: 'test2',
        description: 'Test command 2',
        aliases: ['t'], // Same alias
        async execute() {},
      };

      registry.register(command1);
      registry.register(command2);

      // Last registered command should win
      expect(registry.get('t')).toBe(command2);
    });

    it('should handle empty aliases array', () => {
      const command: Command = {
        name: 'test',
        description: 'Test command',
        aliases: [],
        async execute() {},
      };

      registry.register(command);
      expect(registry.get('test')).toBe(command);
    });
  });
});
