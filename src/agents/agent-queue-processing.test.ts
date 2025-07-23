// ABOUTME: Tests for automatic queue processing on state transitions
// ABOUTME: Ensures messages are processed when agent returns to idle

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { createMockThreadManager } from '~/test-utils/thread-manager-mock';

// Type helper for accessing private methods in tests
type _AgentWithPrivateMethods = Agent & {
  _setState: (state: 'thinking' | 'idle' | 'streaming' | 'tool_execution') => void;
  _processMessage: (...args: unknown[]) => Promise<void>;
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
      stopReason: 'end_turn',
    });
  }
}

describe('Agent Queue Processing', () => {
  let agent: Agent;
  let mockProvider: MockProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(() => {
    setupTestPersistence();
    mockProvider = new MockProvider();

    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getRegisteredTools: vi.fn().mockReturnValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ToolExecutor;

    mockThreadManager = createMockThreadManager();

    const testThreadId = mockThreadManager.getCurrentThreadId()!;

    agent = new Agent({
      provider: mockProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: testThreadId,
      tools: [],
    });
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  describe('processQueuedMessages', () => {
    it('should process queued messages when returning to idle', async () => {
      await agent.start();

      // Queue a message
      agent.queueMessage('test message');

      // Verify message is queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(1);

      // Process queue should process the message
      await agent.processQueuedMessages();

      // Verify message was processed (queue is empty)
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);

      // Verify the message was processed by checking thread events
      const events = mockThreadManager.addEvent as unknown as ReturnType<typeof vi.fn>;
      expect(
        events.mock.calls.some((call) => call[1] === 'USER_MESSAGE' && call[2] === 'test message')
      ).toBe(true);
    });

    it('should process messages in correct order (high priority first)', async () => {
      await agent.start();

      // Queue messages with different priorities
      agent.queueMessage('normal 1');
      agent.queueMessage('high priority', 'user', { priority: 'high' });
      agent.queueMessage('normal 2');

      // Verify all messages queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(3);

      await agent.processQueuedMessages();

      // Verify all messages processed
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);

      // Verify messages were processed by checking thread manager calls
      const addEventCalls = (mockThreadManager.addEvent as unknown as ReturnType<typeof vi.fn>).mock
        .calls;
      const userMessages = addEventCalls.filter((call) => call[1] === 'USER_MESSAGE');
      expect(userMessages.length).toBe(3);

      // High priority should be processed first in the order they were added to thread
      const messageOrder = userMessages.map((call: unknown[]) => call[2] as string);
      expect(messageOrder).toEqual(['high priority', 'normal 1', 'normal 2']);
    });

    it('should not process queue recursively', async () => {
      await agent.start();

      agent.queueMessage('test message');

      // Process queue twice - second call should not process anything since first call already processed the queue
      await agent.processQueuedMessages();
      const statsAfterFirst = agent.getQueueStats();

      await agent.processQueuedMessages();
      const statsAfterSecond = agent.getQueueStats();

      // Both should show empty queue
      expect(statsAfterFirst.queueLength).toBe(0);
      expect(statsAfterSecond.queueLength).toBe(0);

      // Should only have processed message once
      const addEventCalls = (mockThreadManager.addEvent as unknown as ReturnType<typeof vi.fn>).mock
        .calls;
      const userMessages = addEventCalls.filter(
        (call) => call[1] === 'USER_MESSAGE' && call[2] === 'test message'
      );
      expect(userMessages.length).toBe(1);
    });

    it('should handle errors in message processing gracefully', async () => {
      await agent.start();

      // Create a mock provider that will fail on the first message
      let callCount = 0;
      vi.spyOn(mockProvider, 'createResponse').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Processing failed'));
        }
        return Promise.resolve({
          content: 'mock response',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          toolCalls: [],
          stopReason: 'end_turn',
        });
      });

      agent.queueMessage('message 1');
      agent.queueMessage('message 2');

      // Should not throw and should continue processing
      await expect(agent.processQueuedMessages()).resolves.not.toThrow();

      // Both messages should be removed from queue (even if first failed)
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });

    it('should emit queue processing events', async () => {
      await agent.start();
      agent.queueMessage('test message');

      const processingStartEvents: any[] = [];
      const processingCompleteEvents: any[] = [];

      agent.on('queue_processing_start' as any, (data: any) => {
        processingStartEvents.push(data);
      });
      agent.on('queue_processing_complete' as any, (data: any) => {
        processingCompleteEvents.push(data);
      });

      await agent.processQueuedMessages();

      // Verify events were emitted
      expect(processingStartEvents).toHaveLength(1);
      expect(processingCompleteEvents).toHaveLength(1);

      // Verify actual processing occurred
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });
  });

  describe('state transitions', () => {
    it('should trigger queue processing when state becomes idle', async () => {
      await agent.start();
      agent.queueMessage('test message');

      // Verify message is queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(1);

      // Simulate state transition by triggering an actual operation that transitions through states
      await agent.sendMessage('trigger state transition');

      // After the operation completes and returns to idle, the queue should be processed
      // Wait a bit for async queue processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0); // Queue should be processed
    });

    it('should not trigger queue processing for non-idle states', async () => {
      await agent.start();
      agent.queueMessage('test message');

      // Verify message is queued
      const statsBefore = agent.getQueueStats();
      expect(statsBefore.queueLength).toBe(1);

      // Directly setting state to non-idle shouldn't trigger queue processing
      // We can verify this by checking the queue remains unchanged
      const agentAny = agent as unknown as {
        _setState: (state: 'thinking' | 'idle' | 'streaming' | 'tool_execution') => void;
      };
      agentAny._setState('thinking');

      // Wait a bit to ensure no async processing occurs
      await new Promise((resolve) => setTimeout(resolve, 10));

      const statsAfterThinking = agent.getQueueStats();
      expect(statsAfterThinking.queueLength).toBe(1); // Queue unchanged

      // Similarly for other non-idle states
      agentAny._setState('streaming');
      agentAny._setState('tool_execution');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(1); // Queue still unchanged
    });
  });
});
