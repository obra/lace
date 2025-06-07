// ABOUTME: Unit tests for CompletionManager
// ABOUTME: Tests provider coordination, history completion, and context routing

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CompletionManager } from '../../../src/ui/completion/CompletionManager.js';

describe('CompletionManager', () => {
  let manager;
  let mockProvider1;
  let mockProvider2;

  beforeEach(() => {
    manager = new CompletionManager({
      maxItems: 5,
      includeHistory: true,
      history: ['previous command', 'another command']
    });

    // Create mock providers
    mockProvider1 = {
      canHandle: jest.fn(),
      getCompletions: jest.fn()
    };

    mockProvider2 = {
      canHandle: jest.fn(),
      getCompletions: jest.fn()
    };
  });

  describe('provider management', () => {
    it('should add providers', () => {
      manager.addProvider(mockProvider1);
      manager.addProvider(mockProvider2);
      
      expect(manager.providers).toHaveLength(2);
    });

    it('should remove providers', () => {
      manager.addProvider(mockProvider1);
      manager.addProvider(mockProvider2);
      manager.removeProvider(mockProvider1);
      
      expect(manager.providers).toHaveLength(1);
      expect(manager.providers[0]).toBe(mockProvider2);
    });
  });

  describe('getCompletions', () => {
    beforeEach(() => {
      manager.addProvider(mockProvider1);
      manager.addProvider(mockProvider2);
    });

    it('should route to appropriate provider', async () => {
      const context = {
        line: '/help',
        column: 5,
        lineNumber: 0,
        fullText: '/help'
      };

      mockProvider1.canHandle.mockReturnValue(true);
      mockProvider1.getCompletions.mockResolvedValue({
        items: [{ value: 'help', type: 'command', description: 'Help command' }],
        prefix: 'he'
      });

      mockProvider2.canHandle.mockReturnValue(false);

      const result = await manager.getCompletions(context);

      expect(mockProvider1.canHandle).toHaveBeenCalledWith(context);
      expect(mockProvider1.getCompletions).toHaveBeenCalledWith('/he');
      expect(mockProvider2.canHandle).toHaveBeenCalledWith(context);
      expect(mockProvider2.getCompletions).not.toHaveBeenCalled();

      expect(result.items).toHaveLength(1);
      expect(result.items[0].value).toBe('help');
    });

    it('should extract slash command prefix correctly', async () => {
      const context = {
        line: '/help',
        column: 5,
        lineNumber: 0,
        fullText: '/help'
      };

      mockProvider1.canHandle.mockReturnValue(true);
      mockProvider1.getCompletions.mockResolvedValue({
        items: [],
        prefix: '/help'
      });

      await manager.getCompletions(context);

      expect(mockProvider1.getCompletions).toHaveBeenCalledWith('/help');
    });

    it('should extract word prefix for non-commands', async () => {
      const context = {
        line: 'some file.txt',
        column: 9,
        lineNumber: 0,
        fullText: 'some file.txt'
      };

      mockProvider1.canHandle.mockReturnValue(true);
      mockProvider1.getCompletions.mockResolvedValue({
        items: [],
        prefix: 'file.txt'
      });

      await manager.getCompletions(context);

      expect(mockProvider1.getCompletions).toHaveBeenCalledWith('file.txt');
    });

    it('should merge with history completions', async () => {
      const context = {
        line: 'previous',
        column: 8,
        lineNumber: 0,
        fullText: 'previous'
      };

      mockProvider1.canHandle.mockReturnValue(true);
      mockProvider1.getCompletions.mockResolvedValue({
        items: [{ value: 'file.txt', type: 'file', description: 'Text file' }],
        prefix: 'previous'
      });

      const result = await manager.getCompletions(context);

      // Should include both provider result and history
      expect(result.items.length).toBeGreaterThan(1);
      
      const historyItem = result.items.find(item => item.type === 'history');
      expect(historyItem).toBeDefined();
      expect(historyItem.value).toBe('previous command');
    });

    it('should limit total items', async () => {
      const context = {
        line: 'test',
        column: 4,
        lineNumber: 0,
        fullText: 'test'
      };

      // Return more items than maxItems (5)
      const manyItems = Array.from({ length: 10 }, (_, i) => ({
        value: `item${i}`,
        type: 'file',
        description: `Item ${i}`
      }));

      mockProvider1.canHandle.mockReturnValue(true);
      mockProvider1.getCompletions.mockResolvedValue({
        items: manyItems,
        prefix: 'test'
      });

      const result = await manager.getCompletions(context);

      expect(result.items.length).toBeLessThanOrEqual(5);
      expect(result.hasMore).toBe(true);
    });

    it('should fallback to history on provider error', async () => {
      const context = {
        line: 'previous',
        column: 8,
        lineNumber: 0,
        fullText: 'previous'
      };

      mockProvider1.canHandle.mockReturnValue(true);
      mockProvider1.getCompletions.mockRejectedValue(new Error('Provider error'));

      const result = await manager.getCompletions(context);

      // Should only return history completions
      expect(result.items.length).toBeGreaterThan(0);
      const historyItem = result.items.find(item => item.type === 'history');
      expect(historyItem).toBeDefined();
    });

    it('should return history when no provider handles context', async () => {
      const context = {
        line: 'previous',
        column: 8,
        lineNumber: 0,
        fullText: 'previous'
      };

      mockProvider1.canHandle.mockReturnValue(false);
      mockProvider2.canHandle.mockReturnValue(false);

      const result = await manager.getCompletions(context);

      const historyItem = result.items.find(item => item.type === 'history');
      expect(historyItem).toBeDefined();
      expect(historyItem.value).toBe('previous command');
    });
  });

  describe('history management', () => {
    it('should update history', () => {
      const newHistory = ['new command 1', 'new command 2'];
      manager.updateHistory(newHistory);

      const options = manager.getOptions();
      expect(options.history).toEqual(newHistory);
    });

    it('should filter exact matches from history completions', async () => {
      manager.updateHistory(['exact match', 'different command']);

      const context = {
        line: 'exact match',
        column: 11,
        lineNumber: 0,
        fullText: 'exact match'
      };

      mockProvider1.canHandle.mockReturnValue(false);

      const result = await manager.getCompletions(context);

      // Should not include exact match, only partial matches
      const exactMatch = result.items.find(item => item.value === 'exact match');
      expect(exactMatch).toBeUndefined();
    });

    it('should limit history items', async () => {
      const longHistory = Array.from({ length: 20 }, (_, i) => `command${i} test`);
      manager.updateHistory(longHistory);

      const context = {
        line: 'test',
        column: 4,
        lineNumber: 0,
        fullText: 'test'
      };

      mockProvider1.canHandle.mockReturnValue(false);

      const result = await manager.getCompletions(context);

      const historyItems = result.items.filter(item => item.type === 'history');
      expect(historyItems.length).toBeLessThanOrEqual(5); // Limited to 5
    });
  });

  describe('options management', () => {
    it('should get current options', () => {
      const options = manager.getOptions();

      expect(options.maxItems).toBe(5);
      expect(options.includeHistory).toBe(true);
      expect(options.history).toEqual(['previous command', 'another command']);
    });

    it('should update options', () => {
      manager.updateOptions({
        maxItems: 10,
        includeHistory: false
      });

      const options = manager.getOptions();
      expect(options.maxItems).toBe(10);
      expect(options.includeHistory).toBe(false);
      expect(options.history).toEqual(['previous command', 'another command']); // Unchanged
    });
  });
});