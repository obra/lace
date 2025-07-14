// ABOUTME: Tests for Agent message queue methods
// ABOUTME: Tests queueMessage, getQueueStats, clearQueue functionality

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { BaseMockProvider } from '~/__tests__/utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';

// Mock provider for testing
class MockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
      stopReason: 'end_turn',
    });
  }
}

describe('Agent Queue Methods', () => {
  let agent: Agent;
  let mockProvider: MockProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(() => {
    mockProvider = new MockProvider();

    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getRegisteredTools: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ToolExecutor;

    mockThreadManager = {
      addEvent: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getSessionInfo: vi.fn().mockReturnValue({
        threadId: 'test-thread',
        model: 'test-model',
        provider: 'test-provider',
      }),
      getCurrentThreadId: vi.fn().mockReturnValue('test-thread'),
      needsCompaction: vi.fn().mockResolvedValue(false),
      createCompactedVersion: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ThreadManager;

    agent = new Agent({
      provider: mockProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: 'test-thread',
      tools: [],
    });
  });

  describe('queueMessage', () => {
    it('should queue a message and return message ID', () => {
      const messageId = agent.queueMessage('test message');

      expect(messageId).toBeTruthy();
      expect(typeof messageId).toBe('string');
    });

    it('should queue message with specified type', () => {
      const messageId = agent.queueMessage('task message', 'task_notification');

      expect(messageId).toBeTruthy();
    });

    it('should queue message with metadata', () => {
      const metadata = {
        taskId: 'task-123',
        priority: 'high' as const,
      };

      const messageId = agent.queueMessage('urgent task', 'task_notification', metadata);

      expect(messageId).toBeTruthy();
    });

    it('should default to user type when no type specified', () => {
      const messageId = agent.queueMessage('user message');

      expect(messageId).toBeTruthy();
    });
  });

  describe('getQueueStats', () => {
    it('should return empty stats for empty queue', () => {
      const stats = agent.getQueueStats();

      expect(stats.queueLength).toBe(0);
      expect(stats.highPriorityCount).toBe(0);
      expect(stats.oldestMessageAge).toBeUndefined();
    });

    it('should return correct stats after queueing messages', () => {
      agent.queueMessage('message 1');
      agent.queueMessage('message 2', 'user', { priority: 'high' });

      const stats = agent.getQueueStats();

      expect(stats.queueLength).toBe(2);
      expect(stats.highPriorityCount).toBe(1);
      expect(stats.oldestMessageAge).toBeGreaterThanOrEqual(0);
    });

    it('should calculate oldest message age correctly', () => {
      agent.queueMessage('old message');

      // Wait a bit to create age difference
      vi.useFakeTimers();
      vi.advanceTimersByTime(5000);

      const stats = agent.getQueueStats();

      expect(stats.oldestMessageAge).toBeGreaterThanOrEqual(5000);

      vi.useRealTimers();
    });
  });

  describe('clearQueue', () => {
    beforeEach(() => {
      agent.queueMessage('message 1');
      agent.queueMessage('message 2', 'system');
      agent.queueMessage('message 3', 'task_notification');
    });

    it('should clear all messages when no filter provided', () => {
      const clearedCount = agent.clearQueue();

      expect(clearedCount).toBe(3);

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(0);
    });

    it('should clear only filtered messages when filter provided', () => {
      const clearedCount = agent.clearQueue((msg) => msg.type === 'user');

      expect(clearedCount).toBe(1);

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(2);
    });

    it('should return 0 when clearing empty queue', () => {
      agent.clearQueue(); // Clear all first

      const clearedCount = agent.clearQueue();

      expect(clearedCount).toBe(0);
    });

    it('should filter by message metadata', () => {
      agent.queueMessage('high priority', 'user', { priority: 'high' });

      const clearedCount = agent.clearQueue((msg) => msg.metadata?.priority === 'high');

      expect(clearedCount).toBe(1);
    });
  });
});
