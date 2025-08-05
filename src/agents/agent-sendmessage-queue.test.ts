// ABOUTME: Tests for sendMessage queue option functionality
// ABOUTME: Ensures sendMessage can queue messages when agent is busy

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import type { ThreadEvent } from '~/threads/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { createMockThreadManager } from '~/test-utils/thread-manager-mock';

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
  const _tempLaceDir = setupCoreTest();
  let agent: Agent;
  let mockProvider: MockProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;
  let testThreadId: string;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
    mockProvider = new MockProvider();

    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getRegisteredTools: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ToolExecutor;

    let eventCount = 0;

    mockThreadManager = createMockThreadManager();
    testThreadId = 'lace_20250723_abc123';

    // Override addEvent to track event count for this specific test
    mockThreadManager.addEvent = vi.fn((): ThreadEvent => {
      eventCount++;
      const event: ThreadEvent = {
        id: `event_${eventCount}`,
        threadId: testThreadId,
        type: 'USER_MESSAGE' as const,
        data: 'test',
        timestamp: new Date(),
      };
      return event;
    });

    // Override getEvents to return events based on count for this specific test
    mockThreadManager.getEvents = vi.fn((): ThreadEvent[] => {
      const events: ThreadEvent[] = [];
      for (let i = 0; i < eventCount; i++) {
        const event: ThreadEvent = {
          id: `event_${i + 1}`,
          threadId: testThreadId,
          type: 'USER_MESSAGE' as const,
          data: 'test',
          timestamp: new Date(),
        };
        events.push(event);
      }
      return events;
    });

    agent = new Agent({
      provider: mockProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: testThreadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  describe('when agent is idle', () => {
    it('should process message immediately without queue option', async () => {
      const initialThreadEvents = mockThreadManager.getEvents(testThreadId).length;

      await agent.sendMessage('test message');

      // Verify message was processed immediately (added to thread)
      const finalThreadEvents = mockThreadManager.getEvents(testThreadId).length;
      expect(finalThreadEvents).toBeGreaterThan(initialThreadEvents);

      // Verify the message appears in thread manager calls
      const addEventCalls = (mockThreadManager.addEvent as unknown as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(
        addEventCalls.some((call) => call[1] === 'USER_MESSAGE' && call[2] === 'test message')
      ).toBe(true);

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(0);
    });

    it('should process message immediately even with queue option', async () => {
      const initialThreadEvents = mockThreadManager.getEvents(testThreadId).length;

      await agent.sendMessage('test message', { queue: true });

      // Verify message was processed immediately (added to thread) even with queue option
      const finalThreadEvents = mockThreadManager.getEvents(testThreadId).length;
      expect(finalThreadEvents).toBeGreaterThan(initialThreadEvents);

      // Verify the message appears in thread manager calls
      const addEventCalls = (mockThreadManager.addEvent as unknown as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(
        addEventCalls.some((call) => call[1] === 'USER_MESSAGE' && call[2] === 'test message')
      ).toBe(true);
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

      // Return to idle - this should trigger queue processing
      (agent as unknown as AgentWithPrivateMethods)._setState('idle');

      // Allow async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify messages were processed by checking thread manager calls
      const addEventCalls = (mockThreadManager.addEvent as unknown as ReturnType<typeof vi.fn>).mock
        .calls;
      const userMessageCalls = addEventCalls.filter((call) => call[1] === 'USER_MESSAGE');
      const messageContents = userMessageCalls.map((call: unknown[]) => call[2] as string);

      expect(messageContents).toContain('message 1');
      expect(messageContents).toContain('message 2');

      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(0);
    });
  });
});
