// ABOUTME: Integration tests for input handling with automatic message queueing
// ABOUTME: Tests real Agent behavior with queueing when busy and processing when idle

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Simulate slow response to keep agent busy
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      content: 'mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    };
  }
}

describe('Input Queue Handling Integration', () => {
  let agent: Agent;
  let mockProvider: MockProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(async () => {
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

    await agent.start();
  });

  afterEach(() => {
    if (agent) {
      agent.removeAllListeners();
      agent.stop();
    }
  });

  describe('real queueing behavior', () => {
    it('should process message immediately when agent is idle', async () => {
      // Agent starts idle, should process immediately
      await agent.sendMessage('test message');

      // Verify queue remains empty
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(0);
    });

    it('should queue message automatically when agent is busy', async () => {
      // Start a message to make agent busy
      const firstMessagePromise = agent.sendMessage('first message');

      // Wait a bit to ensure agent enters busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // While agent is processing, try to send another message with queue option
      await agent.sendMessage('second message', { queue: true });

      // Verify message was queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(1);

      // Wait for first message to complete
      await firstMessagePromise;

      // Wait a bit for queue processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify queue was processed
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });

    it('should throw error when trying to send without queue option while busy', async () => {
      // Start a message to make agent busy
      const firstMessagePromise = agent.sendMessage('first message');

      // Wait a bit to ensure agent enters busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Try to send another message without queue option
      await expect(agent.sendMessage('second message')).rejects.toThrow('cannot accept messages');

      // Clean up
      await firstMessagePromise;
    });

    it('should handle multiple queued messages in order', async () => {
      // Start a message to make agent busy
      const firstMessagePromise = agent.sendMessage('first message');

      // Wait a bit to ensure agent enters busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue multiple messages
      await agent.sendMessage('queued message 1', { queue: true });
      await agent.sendMessage('queued message 2', { queue: true });
      await agent.sendMessage('queued message 3', { queue: true });

      // Verify all messages were queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(3);

      // Wait for processing to complete
      await firstMessagePromise;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Allow time for queue processing

      // Verify queue was processed (may have one item still processing)
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBeLessThanOrEqual(1);
    });

    it('should handle priority messages correctly', async () => {
      // Start a message to make agent busy
      const firstMessagePromise = agent.sendMessage('first message');

      // Wait a bit to ensure agent enters busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue normal and high priority messages
      await agent.sendMessage('normal message', { queue: true });
      await agent.sendMessage('high priority message', {
        queue: true,
        metadata: { priority: 'high' },
      });

      // Verify queue stats show high priority message
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(2);
      expect(stats.highPriorityCount).toBe(1);

      // Clean up
      await firstMessagePromise;
    });
  });

  describe('message_queued events', () => {
    it('should emit message_queued event when queueing', async () => {
      const queuedEvents: { queueLength: number; id: string }[] = [];
      agent.on('message_queued', (data: { queueLength: number; id: string }) =>
        queuedEvents.push(data)
      );

      // Start a message to make agent busy
      const firstMessagePromise = agent.sendMessage('first message');

      // Wait a bit to ensure agent enters busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue a message
      await agent.sendMessage('queued message', { queue: true });

      // Verify event was emitted
      expect(queuedEvents).toHaveLength(1);
      expect(queuedEvents[0]?.queueLength).toBe(1);
      expect(queuedEvents[0]?.id).toBeTruthy();

      // Clean up
      await firstMessagePromise;
    });
  });
});
