// ABOUTME: Tests for Agent event proxying from ThreadManager events
// ABOUTME: Ensures Agent serves as single event source for interfaces

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from './agent.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ToolExecutor } from '../tools/executor.js';
import { createMockProvider } from '../__tests__/utils/mock-provider.js';
import { ThreadEvent } from '../threads/types.js';

describe('Agent Thread Event Proxying', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    const mockProvider = createMockProvider();
    threadManager = new ThreadManager(':memory:');
    toolExecutor = new ToolExecutor([], {});
    
    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: 'test-thread',
      tools: [],
    });
  });

  it('should emit thread_event_added when ThreadManager emits event_added', async () => {
    const threadEventAddedSpy = vi.fn();
    
    // Listen to Agent event
    agent.on('thread_event_added', threadEventAddedSpy);

    // Create thread and add event
    threadManager.createThread('test-thread');
    const event = threadManager.addEvent('test-thread', 'USER_MESSAGE', 'test message');

    // Agent should proxy the event (when implementation is added)
    expect(threadEventAddedSpy).toHaveBeenCalledWith({
      event,
      threadId: 'test-thread',
    });
  });

  it('should emit thread_state_changed when ThreadManager emits thread_updated', async () => {
    const threadUpdatedSpy = vi.fn();
    const threadStateChangedSpy = vi.fn();
    
    // Listen to both events
    threadManager.on('thread_updated', threadUpdatedSpy);
    agent.on('thread_state_changed', threadStateChangedSpy);

    // Create thread and add event to trigger thread_updated
    threadManager.createThread('test-thread');
    threadManager.addEvent('test-thread', 'USER_MESSAGE', 'test message');

    // Both events should be emitted
    expect(threadUpdatedSpy).toHaveBeenCalledWith({
      threadId: 'test-thread',
      eventType: 'USER_MESSAGE',
    });
    expect(threadStateChangedSpy).toHaveBeenCalledWith({
      threadId: 'test-thread', 
      eventType: 'USER_MESSAGE',
    });
  });

  it('should maintain event payload consistency between ThreadManager and Agent events', async () => {
    const threadEventAddedSpy = vi.fn();
    agent.on('thread_event_added', threadEventAddedSpy);

    // Create thread and add event
    threadManager.createThread('test-thread');
    const event = threadManager.addEvent('test-thread', 'USER_MESSAGE', 'test message');

    // Check that Agent event has identical payload (when implementation is added)
    expect(threadEventAddedSpy).toHaveBeenCalledWith({
      event,
      threadId: 'test-thread',
    });

    // Verify event object is identical
    const agentEventPayload = threadEventAddedSpy.mock.calls[0][0];
    expect(agentEventPayload.event).toBe(event);
    expect(agentEventPayload.threadId).toBe('test-thread');
  });

  it('should handle event proxying with no active listeners', async () => {
    // Create thread and add event with no listeners
    threadManager.createThread('test-thread');
    
    // Should not throw error
    expect(() => {
      threadManager.addEvent('test-thread', 'USER_MESSAGE', 'test message');
    }).not.toThrow();
  });
});