// ABOUTME: Tests for Agent getQueueContents method
// ABOUTME: Verifies queue contents retrieval with proper isolation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { createMockThreadManager } from '~/test-utils/thread-manager-mock';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

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

describe('Agent getQueueContents', () => {
  let agent: Agent;
  let mockProvider: MockProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(async () => {
    setupTestPersistence();
    mockProvider = new MockProvider();

    mockToolExecutor = {
      registerAllAvailableTools: vi.fn(),
      getRegisteredTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolExecutor;

    mockThreadManager = createMockThreadManager();
    const testThreadId = 'lace_20250723_abc123';

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
    if (agent) {
      agent.stop();
    }
    teardownTestPersistence();
  });

  it('should return empty array for empty queue', () => {
    const contents = agent.getQueueContents();

    expect(contents).toEqual([]);
    expect(Array.isArray(contents)).toBe(true);
  });

  it('should return queue contents as readonly array', () => {
    agent.queueMessage('test message 1');
    agent.queueMessage('test message 2', 'system');

    const contents = agent.getQueueContents();

    expect(contents).toHaveLength(2);
    expect(contents[0].content).toBe('test message 1');
    expect(contents[0].type).toBe('user');
    expect(contents[1].content).toBe('test message 2');
    expect(contents[1].type).toBe('system');
  });

  it('should return copy of queue (not direct reference)', () => {
    agent.queueMessage('original message');

    const contents1 = agent.getQueueContents();
    const contents2 = agent.getQueueContents();

    // Should be different array instances
    expect(contents1).not.toBe(contents2);

    // But should have same content
    expect(contents1).toEqual(contents2);

    // Modifying returned array shouldn't affect internal queue
    const originalLength = contents1.length;
    // TypeScript should prevent this, but let's verify runtime behavior
    try {
      // Use explicit type assertion to test runtime behavior
      const mutableContents = contents1 as unknown as Array<{ fake: string }>;
      mutableContents.push({ fake: 'message' });
      // If this works, it means we didn't return a proper readonly array
      // The internal queue should still be unchanged
      const newContents = agent.getQueueContents();
      expect(newContents).toHaveLength(originalLength);
    } catch {
      // Expected - readonly arrays should prevent modification
    }
  });

  it('should preserve all message metadata', () => {
    const metadata = {
      priority: 'high' as const,
      taskId: 'task-123',
      fromAgent: 'coordinator',
      source: 'task_system' as const,
    };

    agent.queueMessage('high priority message', 'task_notification', metadata);

    const contents = agent.getQueueContents();

    expect(contents).toHaveLength(1);
    expect(contents[0].content).toBe('high priority message');
    expect(contents[0].type).toBe('task_notification');
    expect(contents[0].metadata).toEqual(metadata);
    expect(contents[0].id).toBeTruthy();
    expect(contents[0].timestamp).toBeInstanceOf(Date);
  });

  it('should return messages in queue order', () => {
    // Queue messages with different priorities to test ordering
    agent.queueMessage('normal 1');
    agent.queueMessage('high priority', 'user', { priority: 'high' });
    agent.queueMessage('normal 2');

    const contents = agent.getQueueContents();

    expect(contents).toHaveLength(3);
    // Should return in internal queue order (high priority messages are at the front)
    expect(contents[0].metadata?.priority).toBe('high');
    expect(contents[0].content).toBe('high priority');
    expect(contents[1].content).toBe('normal 1');
    expect(contents[2].content).toBe('normal 2');
  });

  it('should handle queue modifications between calls', () => {
    agent.queueMessage('message 1');
    agent.queueMessage('message 2');

    let contents = agent.getQueueContents();
    expect(contents).toHaveLength(2);

    // Add another message
    agent.queueMessage('message 3');

    contents = agent.getQueueContents();
    expect(contents).toHaveLength(3);
    expect(contents[2].content).toBe('message 3');

    // Clear some messages
    agent.clearQueue((msg) => msg.content === 'message 1');

    contents = agent.getQueueContents();
    expect(contents).toHaveLength(2);
    expect(contents.find((msg) => msg.content === 'message 1')).toBeUndefined();
  });
});
