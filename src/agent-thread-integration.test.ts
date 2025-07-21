// ABOUTME: Integration test for Agent as single event source architecture
// ABOUTME: Verifies Agent correctly emits events for thread operations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { createMockProvider } from '~/__tests__/utils/mock-provider';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

describe('Agent Single Event Source Integration', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    setupTestPersistence();
    const mockProvider = createMockProvider();
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: 'integration-test-thread',
      tools: [],
    });
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should emit Agent events for thread operations', async () => {
    // Set up listeners for Agent events only
    const agentThreadEventAdded = vi.fn();

    agent.on('thread_event_added', agentThreadEventAdded);

    // Create thread
    threadManager.createThread('integration-test-thread');

    // Start agent so we can send messages (which will trigger _addEventAndEmit)
    await agent.start();

    // Use Agent methods that trigger _addEventAndEmit internally
    await agent.sendMessage('test message');

    // Verify Agent events are emitted
    expect(agentThreadEventAdded).toHaveBeenCalledWith({
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
    expect(agent.getCurrentThreadId()).toBe('integration-test-thread');
    expect(typeof agent.getThreadEvents).toBe('function');
    expect(typeof agent.compact).toBe('function');
    expect(typeof agent.resumeOrCreateThread).toBe('function');

    // Verify getThreadEvents returns events
    const events = agent.getThreadEvents('integration-test-thread');
    expect(Array.isArray(events)).toBe(true);
  });

  it('should handle Agent API operations correctly', () => {
    // Create thread and add some events
    threadManager.createThread('api-test-thread');
    threadManager.addEvent('api-test-thread', 'USER_MESSAGE', 'test message 1');
    threadManager.addEvent('api-test-thread', 'AGENT_MESSAGE', 'test response 1');

    // Test getThreadEvents
    const events = agent.getThreadEvents('api-test-thread');
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('USER_MESSAGE');
    expect(events[1].type).toBe('AGENT_MESSAGE');

    // Test compact (should not throw)
    expect(() => agent.compact('api-test-thread')).not.toThrow();
  });
});
