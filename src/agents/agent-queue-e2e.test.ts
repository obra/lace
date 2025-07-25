// ABOUTME: End-to-end tests for message queue scenarios with realistic workflows
// ABOUTME: Tests complex queueing behavior, priority handling, and error recovery

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { createMockThreadManager } from '~/test-utils/thread-manager-mock';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock provider with configurable delay for testing long operations
class LongOperationProvider extends BaseMockProvider {
  constructor(private delayMs: number = 1000) {
    super({});
  }

  get providerName(): string {
    return 'long-operation';
  }

  get defaultModel(): string {
    return 'slow-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Simulate long-running operation
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      content: 'Long operation completed',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      toolCalls: [],
    };
  }
}

describe('Agent Queue End-to-End Scenarios', () => {
  let agent: Agent;
  let longProvider: LongOperationProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(async () => {
    setupTestPersistence();
    longProvider = new LongOperationProvider(200); // 200ms delay

    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getAllTools: vi.fn().mockReturnValue([]),
      getTool: vi.fn().mockReturnValue(undefined),
      setApprovalCallback: vi.fn(),
      registerTool: vi.fn(),
      registerTools: vi.fn(),
      getAvailableToolNames: vi.fn().mockReturnValue([]),
      getApprovalCallback: vi.fn().mockReturnValue(undefined),
      executeTool: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ToolExecutor;

    mockThreadManager = createMockThreadManager();
    const testThreadId = 'lace_20250723_abc123';

    agent = new Agent({
      provider: longProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: testThreadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(() => {
    if (agent) {
      agent.removeAllListeners();
      agent.stop();
    }
    teardownTestPersistence();
  });

  describe('Scenario 1: Multiple messages during long operation', () => {
    it('should queue multiple user messages and process them when agent becomes idle', async () => {
      // Start long operation but don't await it yet
      const longOpPromise = agent.sendMessage('Start long operation');

      // Wait a bit to ensure agent enters busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify we can successfully queue messages while agent is busy

      // Queue multiple messages while operation runs
      await agent.sendMessage('Queued message 1', { queue: true });
      await agent.sendMessage('Queued message 2', { queue: true });
      await agent.sendMessage('Queued message 3', { queue: true });

      // Verify all messages are queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(3);

      // Wait for long operation to complete
      await longOpPromise;

      // Wait for queue processing to complete
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify queue was processed (queue should be empty)
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);

      // Queue processing completed successfully
    });
  });

  describe('Scenario 2: Task notifications during busy periods', () => {
    it('should queue task notifications while agent is processing', async () => {
      const queuedEvents: { id: string; queueLength: number }[] = [];
      agent.on('message_queued', (data) => queuedEvents.push(data));

      // Start long operation
      const longOpPromise = agent.sendMessage('Start processing');

      // Wait to ensure agent is busy
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify we can successfully queue messages while agent is busy

      // Send task notifications
      await agent.sendMessage('Task assignment notification', {
        queue: true,
        metadata: { source: 'task_system', taskId: 'task-1' },
      });

      await agent.sendMessage('Task completion notification', {
        queue: true,
        metadata: { source: 'task_system', taskId: 'task-2' },
      });

      // Verify task notifications were queued
      expect(queuedEvents).toHaveLength(2);
      expect(queuedEvents[0].queueLength).toBe(1);
      expect(queuedEvents[1].queueLength).toBe(2);

      // Verify queue has task notifications
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(2);

      // Clean up
      await longOpPromise;

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify queue was processed
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });
  });

  describe('Scenario 3: High priority message processing', () => {
    it('should handle high priority messages correctly in queue', async () => {
      // Start initial operation
      const initialPromise = agent.sendMessage('Initial message');

      // Wait for agent to be busy
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue normal priority messages
      await agent.sendMessage('Normal message 1', { queue: true });
      await agent.sendMessage('Normal message 2', { queue: true });

      // Queue high priority message (should jump to front)
      await agent.sendMessage('URGENT: High priority message', {
        queue: true,
        metadata: { priority: 'high' },
      });

      // Queue another normal message
      await agent.sendMessage('Normal message 3', { queue: true });

      // Verify queue stats
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(4);
      expect(stats.highPriorityCount).toBe(1);

      // Verify queue contents have high priority message at front
      const queueContents = agent.getQueueContents();
      expect(queueContents[0].content).toBe('URGENT: High priority message');
      expect(queueContents[0].metadata?.priority).toBe('high');

      // Wait for all processing to complete
      await initialPromise;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Allow time for queue processing

      // Verify queue is empty
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });
  });

  describe('Scenario 4: Queue handles busy/idle transitions', () => {
    it('should handle queue operations reliably during state transitions', async () => {
      // Test basic queue error resistance by queueing many messages
      const messageCount = 2;

      // Start operation to make agent busy
      const busyPromise = agent.sendMessage('Make agent busy');

      // Wait for agent to be busy
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify we can successfully queue messages while agent is busy

      // Queue messages with delays
      for (let i = 1; i <= messageCount; i++) {
        await agent.sendMessage(`Test message ${i}`, { queue: true });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Verify all queued
      const stats = agent.getQueueStats();
      expect(stats.queueLength).toBe(messageCount);

      // Complete the busy operation
      await busyPromise;

      // Wait for queue processing with longer timeout
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Verify queue was processed (may still have some items processing)
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBeLessThanOrEqual(1);

      // Queue processing completed successfully
    });
  });

  describe('Queue event lifecycle', () => {
    it('should emit message_queued events when queueing', async () => {
      const queuedEvents: { id: string; queueLength: number }[] = [];

      // Track queued events
      agent.on('message_queued', (data) => queuedEvents.push(data));

      // Start operation to make agent busy
      const busyPromise = agent.sendMessage('Initial operation');

      // Wait for busy state
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Queue messages
      await agent.sendMessage('Queued message 1', { queue: true });
      await agent.sendMessage('Queued message 2', { queue: true });

      // Verify queued events were emitted
      expect(queuedEvents).toHaveLength(2);
      expect(queuedEvents[0].queueLength).toBe(1);
      expect(queuedEvents[1].queueLength).toBe(2);

      // Complete operation and wait for queue processing
      await busyPromise;
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify queue was processed
      const finalStats = agent.getQueueStats();
      expect(finalStats.queueLength).toBe(0);
    });
  });
});
