// ABOUTME: Test suite for EventStreamFirehose singleton implementation
// ABOUTME: Validates base structure, subscription management, and connection handling

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { EventStreamFirehose } from './event-stream-firehose';
import type { LaceEvent } from '@/types/core';

describe('EventStreamFirehose', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
  });

  test('should return the same instance when called multiple times', () => {
    const instance1 = EventStreamFirehose.getInstance();
    const instance2 = EventStreamFirehose.getInstance();
    expect(instance1).toBe(instance2);
  });

  test('should start with no subscriptions and disconnected state', () => {
    const instance = EventStreamFirehose.getInstance();
    expect(instance.getStats().subscriptionCount).toBe(0);
    expect(instance.getStats().isConnected).toBe(false);
  });
});

describe('Subscription Management', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
  });

  test('should add subscription and return unique ID', () => {
    const firehose = EventStreamFirehose.getInstance();
    const mockCallback = vi.fn();
    const filter = { threadIds: ['thread-1'] };

    const subscriptionId = firehose.subscribe(filter, mockCallback);

    expect(typeof subscriptionId).toBe('string');
    expect(subscriptionId.length).toBeGreaterThan(0);
    expect(firehose.getStats().subscriptionCount).toBe(1);
  });

  test('should assign unique IDs to multiple subscriptions', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const id1 = firehose.subscribe({}, callback1);
    const id2 = firehose.subscribe({}, callback2);

    expect(id1).not.toBe(id2);
    expect(firehose.getStats().subscriptionCount).toBe(2);
  });

  test('should remove subscription by ID', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    const subscriptionId = firehose.subscribe({}, callback);
    expect(firehose.getStats().subscriptionCount).toBe(1);

    firehose.unsubscribe(subscriptionId);
    expect(firehose.getStats().subscriptionCount).toBe(0);
  });

  test('should handle unsubscribing non-existent ID gracefully', () => {
    const firehose = EventStreamFirehose.getInstance();

    expect(() => {
      firehose.unsubscribe('non-existent-id');
    }).not.toThrow();
  });
});

describe('Connection Management', () => {
  // Mock EventSource globally for tests
  const mockEventSource = vi.fn();

  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
    mockEventSource.mockClear();

    // Create a proper mock EventSource instance
    const mockInstance = {
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      url: '/api/events/stream',
      readyState: 0,
      CONNECTING: 0,
      OPEN: 1,
      CLOSED: 2,
    };

    mockEventSource.mockReturnValue(mockInstance);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockEventSource as any).CONNECTING = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockEventSource as any).OPEN = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockEventSource as any).CLOSED = 2;
    global.EventSource = mockEventSource as unknown as typeof EventSource;
  });

  test('should connect when first subscription added', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({}, callback);

    expect(mockEventSource).toHaveBeenCalledWith('/api/events/stream');
    expect(firehose.getStats().isConnected).toBe(false); // Will be true after onopen
  });

  test('should not create new connection for additional subscriptions', () => {
    const firehose = EventStreamFirehose.getInstance();

    firehose.subscribe({}, vi.fn());
    firehose.subscribe({}, vi.fn());

    // Should only be called once total (from previous test state)
    expect(mockEventSource).toHaveBeenCalledTimes(1);
  });

  test('should disconnect when last subscription removed', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    const subscriptionId = firehose.subscribe({}, callback);
    const mockClose = vi.fn();

    // Mock the eventSource instance
    firehose['eventSource'] = { close: mockClose } as unknown as EventSource;

    firehose.unsubscribe(subscriptionId);

    expect(mockClose).toHaveBeenCalled();
  });
});

describe('Event Filtering and Routing', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
  });

  test('should route event to matching subscriptions only', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    // Different filters
    firehose.subscribe({ threadIds: ['thread-1'] }, callback1);
    firehose.subscribe({ threadIds: ['thread-2'] }, callback2);
    firehose.subscribe({ sessionIds: ['session-1'] }, callback3);

    const testEvent: LaceEvent = {
      id: 'event-1',
      type: 'USER_MESSAGE',
      data: 'test message',
      timestamp: new Date(),
      context: { threadId: 'thread-1', sessionId: 'session-1' },
    };

    // Simulate receiving event
    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(testEvent);

    expect(callback1).toHaveBeenCalledWith(testEvent); // Matches threadId
    expect(callback2).not.toHaveBeenCalled(); // Wrong threadId
    expect(callback3).toHaveBeenCalledWith(testEvent); // Matches sessionId
  });

  test('should handle events with missing context fields', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({ sessionIds: ['session-1'] }, callback);

    const eventWithoutContext: LaceEvent = {
      id: 'event-2',
      type: 'LOCAL_SYSTEM_MESSAGE',
      data: 'system event',
      timestamp: new Date(),
      context: { threadId: 'system' },
      // No additional context fields
    } as LaceEvent;

    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(
      eventWithoutContext
    );

    expect(callback).not.toHaveBeenCalled(); // No session context to match
  });

  test('should route to all subscriptions with empty filters', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    // Empty filters should match everything
    firehose.subscribe({}, callback1);
    firehose.subscribe({}, callback2);

    const testEvent: LaceEvent = {
      id: 'event-3',
      type: 'USER_MESSAGE',
      data: 'any message',
      timestamp: new Date(),
      context: { threadId: 'any-thread' },
    };

    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(testEvent);

    expect(callback1).toHaveBeenCalledWith(testEvent);
    expect(callback2).toHaveBeenCalledWith(testEvent);
  });

  test('should handle callback errors without breaking other callbacks', () => {
    const firehose = EventStreamFirehose.getInstance();
    const errorCallback = vi.fn().mockImplementation(() => {
      throw new Error('Callback error');
    });
    const goodCallback = vi.fn();

    firehose.subscribe({}, errorCallback);
    firehose.subscribe({}, goodCallback);

    const testEvent: LaceEvent = {
      id: 'event-4',
      type: 'USER_MESSAGE',
      data: 'test',
      timestamp: new Date(),
      context: { threadId: 'thread' },
    };

    expect(() => {
      (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(testEvent);
    }).not.toThrow();

    expect(errorCallback).toHaveBeenCalled();
    expect(goodCallback).toHaveBeenCalledWith(testEvent);
  });
});

describe('SuperJSON Event Parsing', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
  });

  test('should correctly parse SuperJSON-formatted events', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({ threadIds: ['test-thread'] }, callback);

    // Simulate a SuperJSON-formatted event like the server sends
    const superJsonEvent = {
      json: {
        id: 'test-event-1',
        type: 'USER_MESSAGE',
        data: 'Hello world',
        timestamp: '2025-08-19T20:55:00.000Z',
        context: { threadId: 'test-thread' },
      },
      meta: {
        values: {
          'context.threadId': [['custom', 'ThreadId']],
          timestamp: ['Date'],
        },
      },
    };

    // Simulate receiving the event as a MessageEvent
    const messageEvent = {
      data: JSON.stringify(superJsonEvent),
    } as MessageEvent;

    // Test the event handling
    (
      firehose as unknown as { handleIncomingEvent: (event: MessageEvent) => void }
    ).handleIncomingEvent(messageEvent);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-event-1',
        type: 'USER_MESSAGE',
        data: 'Hello world',
        timestamp: expect.any(Date), // SuperJSON should deserialize this to a Date object
        context: expect.objectContaining({ threadId: 'test-thread' }),
      })
    );
  });

  test('should handle malformed SuperJSON events gracefully', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({}, callback);

    // Simulate a malformed event
    const messageEvent = {
      data: 'invalid json{',
    } as MessageEvent;

    // Should not throw
    expect(() => {
      (
        firehose as unknown as { handleIncomingEvent: (event: MessageEvent) => void }
      ).handleIncomingEvent(messageEvent);
    }).not.toThrow();

    // Callback should not be called for malformed events
    expect(callback).not.toHaveBeenCalled();
  });

  test('should handle different event types with SuperJSON parsing', () => {
    const firehose = EventStreamFirehose.getInstance();
    const userMessageCallback = vi.fn();
    const agentStateCallback = vi.fn();

    firehose.subscribe({ threadIds: ['agent-thread'] }, userMessageCallback);
    firehose.subscribe({ threadIds: ['agent-thread'] }, agentStateCallback);

    // Test AGENT_STATE_CHANGE event with nested data
    const agentStateEvent = {
      json: {
        id: 'state-event-1',
        type: 'AGENT_STATE_CHANGE',
        data: {
          agentId: 'agent-123',
          from: 'idle',
          to: 'thinking',
        },
        timestamp: '2025-08-19T20:55:00.000Z',
        transient: true,
        context: { threadId: 'agent-thread' },
      },
      meta: {
        values: {
          'context.threadId': [['custom', 'ThreadId']],
          timestamp: ['Date'],
          'data.agentId': [['custom', 'ThreadId']],
        },
      },
    };

    const messageEvent = {
      data: JSON.stringify(agentStateEvent),
    } as MessageEvent;

    (
      firehose as unknown as { handleIncomingEvent: (event: MessageEvent) => void }
    ).handleIncomingEvent(messageEvent);

    // Both callbacks should receive the event since they both match the filter
    expect(userMessageCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AGENT_STATE_CHANGE',
        data: {
          agentId: 'agent-123',
          from: 'idle',
          to: 'thinking',
        },
        transient: true,
        context: expect.objectContaining({ threadId: 'agent-thread' }),
      })
    );
    expect(agentStateCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AGENT_STATE_CHANGE',
      })
    );
  });
});

describe('Event Filtering Integration', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
  });

  test('should properly filter events based on threadId with SuperJSON', () => {
    const firehose = EventStreamFirehose.getInstance();
    const thread1Callback = vi.fn();
    const thread2Callback = vi.fn();

    firehose.subscribe({ threadIds: ['thread-1'] }, thread1Callback);
    firehose.subscribe({ threadIds: ['thread-2'] }, thread2Callback);

    // Event for thread-1
    const thread1Event = {
      json: {
        id: 'event-thread-1',
        type: 'USER_MESSAGE',
        data: 'Message for thread 1',
        timestamp: '2025-08-19T20:55:00.000Z',
        context: { threadId: 'thread-1' },
      },
      meta: {
        values: {
          'context.threadId': [['custom', 'ThreadId']],
          timestamp: ['Date'],
        },
      },
    };

    const messageEvent1 = {
      data: JSON.stringify(thread1Event),
    } as MessageEvent;

    (
      firehose as unknown as { handleIncomingEvent: (event: MessageEvent) => void }
    ).handleIncomingEvent(messageEvent1);

    expect(thread1Callback).toHaveBeenCalledTimes(1);
    expect(thread2Callback).not.toHaveBeenCalled();
  });

  test("should handle system events that don't match thread filters", () => {
    const firehose = EventStreamFirehose.getInstance();
    const threadCallback = vi.fn();
    const globalCallback = vi.fn();

    firehose.subscribe({ threadIds: ['specific-thread'] }, threadCallback);
    firehose.subscribe({}, globalCallback); // No filter = matches everything

    // System event
    const systemEvent = {
      json: {
        id: 'system-event-1',
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: 'Ready!',
        timestamp: '2025-08-19T20:55:00.000Z',
        transient: true,
        context: { threadId: 'system' },
      },
      meta: {
        values: {
          timestamp: ['Date'],
        },
      },
    };

    const messageEvent = {
      data: JSON.stringify(systemEvent),
    } as MessageEvent;

    (
      firehose as unknown as { handleIncomingEvent: (event: MessageEvent) => void }
    ).handleIncomingEvent(messageEvent);

    expect(threadCallback).not.toHaveBeenCalled(); // Doesn't match thread filter
    expect(globalCallback).toHaveBeenCalledTimes(1); // Matches global filter
  });
});

describe('Compaction Events Routing', () => {
  beforeEach(() => {
    // Reset singleton between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventStreamFirehose as any).instance = null;
  });

  test('should route COMPACTION_START events to matching subscriptions', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({ projectIds: ['test-project'], sessionIds: ['test-session'] }, callback);

    const compactionStartEvent: LaceEvent = {
      id: 'compaction-start-1',
      type: 'COMPACTION_START',
      timestamp: new Date(),
      data: { auto: true },
      transient: true,
      context: {
        threadId: 'lace_20250820_test',
        sessionId: 'test-session',
        projectId: 'test-project',
      },
    };

    // Simulate event routing
    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(
      compactionStartEvent
    );

    expect(callback).toHaveBeenCalledWith(compactionStartEvent);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('should route COMPACTION_COMPLETE events to matching subscriptions', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({ projectIds: ['test-project'], sessionIds: ['test-session'] }, callback);

    const compactionCompleteEvent: LaceEvent = {
      id: 'compaction-complete-1',
      type: 'COMPACTION_COMPLETE',
      timestamp: new Date(),
      data: { success: true },
      transient: true,
      context: {
        threadId: 'lace_20250820_test',
        sessionId: 'test-session',
        projectId: 'test-project',
      },
    };

    // Simulate event routing
    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(
      compactionCompleteEvent
    );

    expect(callback).toHaveBeenCalledWith(compactionCompleteEvent);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('should filter compaction events by context', () => {
    const firehose = EventStreamFirehose.getInstance();
    const matchingCallback = vi.fn();
    const nonMatchingCallback = vi.fn();

    firehose.subscribe({ projectIds: ['project-1'] }, matchingCallback);
    firehose.subscribe({ projectIds: ['project-2'] }, nonMatchingCallback);

    const compactionEvent: LaceEvent = {
      id: 'compaction-filtered',
      type: 'COMPACTION_START',
      timestamp: new Date(),
      data: { auto: false },
      transient: true,
      context: {
        threadId: 'lace_20250820_test',
        sessionId: 'session-1',
        projectId: 'project-1',
      },
    };

    // Route the event
    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(compactionEvent);

    // Only the matching subscription should receive the event
    expect(matchingCallback).toHaveBeenCalledWith(compactionEvent);
    expect(matchingCallback).toHaveBeenCalledTimes(1);
    expect(nonMatchingCallback).not.toHaveBeenCalled();
  });

  test('should handle both manual and auto compaction events', () => {
    const firehose = EventStreamFirehose.getInstance();
    const callback = vi.fn();

    firehose.subscribe({}, callback); // Match all events

    const manualCompaction: LaceEvent = {
      id: 'manual-compaction',
      type: 'COMPACTION_START',
      timestamp: new Date(),
      data: { auto: false },
      transient: true,
      context: { threadId: 'lace_20250820_test', sessionId: 'test-session' },
    };

    const autoCompaction: LaceEvent = {
      id: 'auto-compaction',
      type: 'COMPACTION_START',
      timestamp: new Date(),
      data: { auto: true },
      transient: true,
      context: { threadId: 'lace_20250820_test', sessionId: 'test-session' },
    };

    // Route both events
    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(
      manualCompaction
    );
    (firehose as unknown as { routeEvent: (event: LaceEvent) => void }).routeEvent(autoCompaction);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledWith(manualCompaction);
    expect(callback).toHaveBeenCalledWith(autoCompaction);
  });
});
