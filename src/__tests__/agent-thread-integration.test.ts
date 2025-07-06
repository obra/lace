// ABOUTME: Integration test for dual event system during transition phase
// ABOUTME: Verifies both ThreadManager and Agent events work simultaneously 

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '../agents/agent.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ToolExecutor } from '../tools/executor.js';
import { createMockProvider } from './utils/mock-provider.js';

describe('Agent-ThreadManager Dual Event System Integration', () => {
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
      threadId: 'integration-test-thread',
      tools: [],
    });
  });

  it('should emit both ThreadManager and Agent events during transition phase', async () => {
    // Set up listeners for both event systems
    const threadManagerEventAdded = vi.fn();
    const threadManagerThreadUpdated = vi.fn();
    const agentThreadEventAdded = vi.fn();
    const agentThreadStateChanged = vi.fn();

    threadManager.on('event_added', threadManagerEventAdded);
    threadManager.on('thread_updated', threadManagerThreadUpdated);
    agent.on('thread_event_added', agentThreadEventAdded);
    agent.on('thread_state_changed', agentThreadStateChanged);

    // Create thread and add event
    threadManager.createThread('integration-test-thread');
    const event = threadManager.addEvent('integration-test-thread', 'USER_MESSAGE', 'test message');

    // Verify ThreadManager events
    expect(threadManagerEventAdded).toHaveBeenCalledWith({
      event,
      threadId: 'integration-test-thread',
    });
    expect(threadManagerThreadUpdated).toHaveBeenCalledWith({
      threadId: 'integration-test-thread',
      eventType: 'USER_MESSAGE',
    });

    // Verify Agent events (proxied)
    expect(agentThreadEventAdded).toHaveBeenCalledWith({
      event,
      threadId: 'integration-test-thread',
    });
    expect(agentThreadStateChanged).toHaveBeenCalledWith({
      threadId: 'integration-test-thread',
      eventType: 'USER_MESSAGE',
    });
  });

  it('should maintain event timing and ordering between systems', async () => {
    const allEvents: Array<{ source: string; type: string; timestamp: number }> = [];

    // Capture events with timestamps
    threadManager.on('event_added', () => {
      allEvents.push({ source: 'ThreadManager', type: 'event_added', timestamp: Date.now() });
    });
    
    threadManager.on('thread_updated', () => {
      allEvents.push({ source: 'ThreadManager', type: 'thread_updated', timestamp: Date.now() });
    });

    agent.on('thread_event_added', () => {
      allEvents.push({ source: 'Agent', type: 'thread_event_added', timestamp: Date.now() });
    });

    agent.on('thread_state_changed', () => {
      allEvents.push({ source: 'Agent', type: 'thread_state_changed', timestamp: Date.now() });
    });

    // Create thread and add multiple events
    threadManager.createThread('integration-test-thread');
    threadManager.addEvent('integration-test-thread', 'USER_MESSAGE', 'message 1');
    threadManager.addEvent('integration-test-thread', 'AGENT_MESSAGE', 'response 1');

    // Verify all events were captured
    expect(allEvents).toHaveLength(8); // 4 events × 2 listeners each
    
    // Verify events are in reasonable temporal order (allow for small timing variations)
    for (let i = 1; i < allEvents.length; i++) {
      expect(allEvents[i].timestamp).toBeGreaterThanOrEqual(allEvents[i-1].timestamp - 10);
    }
  });

  it('should handle multiple rapid events without event loss', async () => {
    const threadManagerEvents: string[] = [];
    const agentEvents: string[] = [];

    threadManager.on('event_added', (data) => {
      threadManagerEvents.push(`event_added:${data.threadId}`);
    });
    
    agent.on('thread_event_added', (data) => {
      agentEvents.push(`thread_event_added:${data.threadId}`);
    });

    // Create thread and add rapid fire events
    threadManager.createThread('integration-test-thread');
    
    const eventCount = 10;
    for (let i = 0; i < eventCount; i++) {
      threadManager.addEvent('integration-test-thread', 'USER_MESSAGE', `message ${i}`);
    }

    // Verify no events were lost in either system
    expect(threadManagerEvents).toHaveLength(eventCount);
    expect(agentEvents).toHaveLength(eventCount);
    
    // Verify all events have correct thread ID
    threadManagerEvents.forEach(event => {
      expect(event).toBe('event_added:integration-test-thread');
    });
    
    agentEvents.forEach(event => {
      expect(event).toBe('thread_event_added:integration-test-thread');
    });
  });
});