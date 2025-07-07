// ABOUTME: Tests for Agent as single event source (ThreadManager no longer emits events)
// ABOUTME: Ensures Agent methods emit thread_event_added events for UI updates

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent.js';
import { ThreadManager } from '~/threads/thread-manager.js';
import { ToolExecutor } from '~/tools/executor.js';
import { createMockProvider } from '~/__tests__/utils/mock-provider.js';

describe('Agent Thread Event Proxying', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    const mockProvider = createMockProvider();
    threadManager = new ThreadManager(':memory:');
    toolExecutor = new ToolExecutor();

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: 'test-thread',
      tools: [],
    });
  });

  it('should emit thread_event_added when Agent processes user messages', async () => {
    const threadEventAddedSpy = vi.fn();

    // Listen to Agent event
    agent.on('thread_event_added', threadEventAddedSpy);

    // Create thread and start agent
    agent.createThread('test-thread');
    await agent.start();

    // Send message through Agent (this should emit events)
    await agent.sendMessage('test message');

    // Agent should emit events for both USER_MESSAGE and AGENT_MESSAGE
    expect(threadEventAddedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'test message',
        }),
        threadId: 'test-thread',
      })
    );
  });

  it('should emit thread_event_added for each event during conversation', async () => {
    const threadEventAddedSpy = vi.fn();

    // Listen to Agent events
    agent.on('thread_event_added', threadEventAddedSpy);

    // Create thread and start agent
    agent.createThread('test-thread');
    await agent.start();

    // Send message through Agent
    await agent.sendMessage('test message');

    // Should emit events for USER_MESSAGE and any AGENT_MESSAGE/TOOL_CALL events
    expect(threadEventAddedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
        }),
        threadId: 'test-thread',
      })
    );

    // Should have been called at least once for the user message
    expect(threadEventAddedSpy).toHaveBeenCalled();
  });

  it('should emit consistent event payloads with valid ThreadEvent structure', async () => {
    const threadEventAddedSpy = vi.fn();
    agent.on('thread_event_added', threadEventAddedSpy);

    // Create thread and start agent
    agent.createThread('test-thread');
    await agent.start();

    // Send message
    await agent.sendMessage('test message');

    // Verify event structure
    expect(threadEventAddedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          id: expect.any(String),
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          data: 'test message',
          timestamp: expect.any(Date),
        }),
        threadId: 'test-thread',
      })
    );
  });

  it('should handle Agent operations with no active event listeners', async () => {
    // Create thread and start agent with no listeners
    agent.createThread('test-thread');
    await agent.start();

    // Should not throw error when sending messages with no listeners
    await expect(agent.sendMessage('test message')).resolves.not.toThrow();
  });
});
