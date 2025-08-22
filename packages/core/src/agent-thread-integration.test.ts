// ABOUTME: Integration test for Agent as single event source architecture
// ABOUTME: Verifies Agent correctly emits events for thread operations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { createMockProvider } from '~/test-utils/mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Agent Single Event Source Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    const mockProvider = createMockProvider();
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();

    agent = new Agent({
      toolExecutor,
      threadManager,
      threadId: 'integration-test-thread',
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(mockProvider);
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  it('should emit Agent events for thread operations', async () => {
    // Set up listeners for Agent events only
    const agentLaceEventAdded = vi.fn();

    agent.on('thread_event_added', agentLaceEventAdded);

    // Create thread
    threadManager.createThread('integration-test-thread');

    // Start agent so we can send messages (which will trigger _addEventAndEmit)
    await agent.start();

    // Set model metadata for the agent (required for model-agnostic providers)
    agent.updateThreadMetadata({
      modelId: 'test-model',
      providerInstanceId: 'test-instance',
    });

    // Use Agent methods that trigger _addEventAndEmit internally
    await agent.sendMessage('test message');

    // Verify Agent events are emitted
    expect(agentLaceEventAdded).toHaveBeenCalledWith({
      event: expect.objectContaining({
        type: 'USER_MESSAGE',
        data: 'test message',
      }) as object,
      threadId: 'integration-test-thread',
    });
  });

  it('should provide Agent API methods for thread operations', () => {
    // Create the agent's thread
    threadManager.createThread('integration-test-thread');

    // Test Agent API methods exist and work
    expect(agent.getThreadId()).toBe('integration-test-thread');
    expect(typeof agent.getLaceEvents).toBe('function');
    expect(typeof agent.compact).toBe('function');
    expect(typeof agent.resumeOrCreateThread).toBe('function');

    // Verify getLaceEvents returns events
    const events = agent.getLaceEvents('integration-test-thread');
    expect(Array.isArray(events)).toBe(true);
  });

  it('should handle Agent API operations correctly', () => {
    // Create thread and add some events
    threadManager.createThread('api-test-thread');
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      threadId: 'api-test-thread',
      data: 'test message 1',
    });
    threadManager.addEvent({
      type: 'AGENT_MESSAGE',
      threadId: 'api-test-thread',
      data: { content: 'test response 1' },
    });

    // Test getLaceEvents
    const events = agent.getLaceEvents('api-test-thread');
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('USER_MESSAGE');
    expect(events[1].type).toBe('AGENT_MESSAGE');

    // Test compact (should not throw)
    expect(() => agent.compact('api-test-thread')).not.toThrow();
  });
});
