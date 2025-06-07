// ABOUTME: Unit tests for CommandCompletionProvider
// ABOUTME: Tests command completion logic, prioritization, and filtering

import { describe, it, expect, beforeEach } from '@jest/globals';
import { CommandCompletionProvider } from '../../../src/ui/completion/CommandCompletionProvider.js';

describe('CommandCompletionProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new CommandCompletionProvider();
  });

  describe('canHandle', () => {
    it('should handle slash commands on first line', () => {
      const context = {
        line: '/help',
        column: 5,
        lineNumber: 0,
        fullText: '/help'
      };
      
      expect(provider.canHandle(context)).toBe(true);
    });

    it('should not handle non-slash commands', () => {
      const context = {
        line: 'hello world',
        column: 5,
        lineNumber: 0,
        fullText: 'hello world'
      };
      
      expect(provider.canHandle(context)).toBe(false);
    });

    it('should not handle slash commands on non-first line', () => {
      const context = {
        line: '/help',
        column: 5,
        lineNumber: 1,
        fullText: 'first line\n/help'
      };
      
      expect(provider.canHandle(context)).toBe(false);
    });
  });

  describe('getCompletions', () => {
    it('should return completions for empty prefix', () => {
      const result = provider.getCompletions('');
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe('');
      expect(result.items[0]).toHaveProperty('value');
      expect(result.items[0]).toHaveProperty('description');
      expect(result.items[0]).toHaveProperty('type', 'command');
    });

    it('should filter completions by prefix', () => {
      const result = provider.getCompletions('he');
      
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.prefix).toBe('he');
      
      // All results should start with 'he'
      result.items.forEach(item => {
        expect(item.value.toLowerCase()).toMatch(/^he/);
      });
    });

    it('should return help command for "he" prefix', () => {
      const result = provider.getCompletions('he');
      
      const helpCommand = result.items.find(item => item.value === 'help');
      expect(helpCommand).toBeDefined();
      expect(helpCommand.type).toBe('command');
      expect(helpCommand.description).toContain('help');
    });

    it('should handle slash prefix by removing it', () => {
      const result = provider.getCompletions('/he');
      
      expect(result.prefix).toBe('he');
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should sort by priority then alphabetically', () => {
      const result = provider.getCompletions('');
      
      // High priority commands should come first
      const priorities = result.items.map(item => item.priority || 0);
      
      // Check that higher priorities come first (allowing for equal priorities)
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeLessThanOrEqual(priorities[i - 1]);
      }
    });

    it('should return empty for non-matching prefix', () => {
      const result = provider.getCompletions('xyznomatch');
      
      expect(result.items).toHaveLength(0);
      expect(result.prefix).toBe('xyznomatch');
    });
  });

  describe('command management', () => {
    it('should add custom commands', () => {
      provider.addCommand('test', 'Test command');
      
      const result = provider.getCompletions('te');
      const testCommand = result.items.find(item => item.value === 'test');
      
      expect(testCommand).toBeDefined();
      expect(testCommand.description).toBe('Test command');
    });

    it('should remove commands', () => {
      provider.addCommand('test', 'Test command');
      provider.removeCommand('test');
      
      const result = provider.getCompletions('te');
      const testCommand = result.items.find(item => item.value === 'test');
      
      expect(testCommand).toBeUndefined();
    });

    it('should handle slash prefix in add/remove commands', () => {
      provider.addCommand('test', 'Test command');
      provider.removeCommand('/test'); // With slash
      
      const result = provider.getCompletions('te');
      const testCommand = result.items.find(item => item.value === 'test');
      
      expect(testCommand).toBeUndefined();
    });

    it('should get all commands', () => {
      const commands = provider.getAllCommands();
      
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0]).toHaveProperty('command');
      expect(commands[0]).toHaveProperty('description');
    });
  });
});