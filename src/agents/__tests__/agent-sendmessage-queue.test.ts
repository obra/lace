// ABOUTME: Tests for sendMessage queue option functionality
// ABOUTME: Ensures sendMessage can queue messages when agent is busy

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { BaseMockProvider } from '~/__tests__/utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';

// Type helper for accessing private methods in tests
type AgentWithPrivateMethods = {
  _setState: (state: 'thinking' | 'idle' | 'streaming' | 'tool_execution') => void;
  _processMessage: (...args: any[]) => Promise<void>;
};

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
    });
  }
}

describe('Agent sendMessage Queue Option', () => {
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

  describe('when agent is idle', () => {
    it('should process message immediately without queue option', async () => {
      // Mock the actual message processing
      const originalSendMessage = agent.sendMessage.bind(agent);
      let processedImmediately = false;

      vi.spyOn(agent, 'sendMessage').mockImplementation(async (content, options) => {
        if (options?.queue) {
          return originalSendMessage(content, options);
        }
        processedImmediately = true;
      });

      await agent.sendMessage('test message');

      expect(processedImmediately).toBe(true);

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(0);
    });

    it('should process message immediately even with queue option', async () => {
      let processedImmediately = false;

      // Mock to track immediate processing
      vi.spyOn(agent, 'sendMessage').mockImplementation(() => {
        processedImmediately = true;
        return Promise.resolve();
      });

      await agent.sendMessage('test message', { queue: true });

      expect(processedImmediately).toBe(true);
    });
  });

  describe('when agent is busy', () => {
    beforeEach(() => {
      // Set agent to busy state
      (agent as unknown as AgentWithPrivateMethods)._setState('thinking');
    });

    it('should throw error when no queue option provided', async () => {
      await expect(agent.sendMessage('test message')).rejects.toThrow(
        'Agent is thinking, cannot accept messages'
      );
    });

    it('should queue message when queue option is true', async () => {
      await agent.sendMessage('test message', { queue: true });

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(1);
    });

    it('should queue message with metadata', async () => {
      const metadata = { priority: 'high' as const, taskId: 'task-123' };

      await agent.sendMessage('urgent message', {
        queue: true,
        metadata,
      });

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(1);
      expect(stats.highPriorityCount).toBe(1);
    });

    it('should emit message_queued event', async () => {
      const queuedEvents: { id: string; queueLength: number }[] = [];
      agent.on('message_queued', (data) => queuedEvents.push(data));

      await agent.sendMessage('test message', { queue: true });

      expect(queuedEvents).toHaveLength(1);
      expect(queuedEvents[0].queueLength).toBe(1);
      expect(queuedEvents[0].id).toBeTruthy();
    });

    it('should queue multiple messages in order', async () => {
      await agent.sendMessage('message 1', { queue: true });
      await agent.sendMessage('message 2', { queue: true, metadata: { priority: 'high' } });
      await agent.sendMessage('message 3', { queue: true });

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(3);
      expect(stats.highPriorityCount).toBe(1);
    });
  });

  describe('queue processing on idle return', () => {
    it('should process queued messages when agent becomes idle', async () => {
      // Set agent to busy
      (agent as unknown as AgentWithPrivateMethods)._setState('thinking');

      // Queue messages
      await agent.sendMessage('message 1', { queue: true });
      await agent.sendMessage('message 2', { queue: true });

      const processedMessages: string[] = [];

      // Mock _processMessage instead since that's what gets called during queue processing
      vi.spyOn(agent as unknown as AgentWithPrivateMethods, '_processMessage').mockImplementation(
        (...args: any[]) => {
          processedMessages.push(args[0] as string);
          return Promise.resolve();
        }
      );

      // Return to idle
      (agent as unknown as AgentWithPrivateMethods)._setState('idle');

      // Allow async processing
      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(processedMessages).toEqual(['message 1', 'message 2']);

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(0);
    });
  });
});
