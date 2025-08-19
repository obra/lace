// ABOUTME: Test suite for EventStreamFirehose singleton implementation
// ABOUTME: Validates base structure, subscription management, and connection handling

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { EventStreamFirehose } from './event-stream-firehose';

describe('EventStreamFirehose', () => {
  beforeEach(() => {
    // Reset singleton between tests
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
    (EventStreamFirehose as any).instance = null;
    mockEventSource.mockClear();

    // Create a proper mock EventSource instance
    const mockInstance = {
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      url: '/api/events/stream',
    };

    mockEventSource.mockReturnValue(mockInstance);
    global.EventSource = mockEventSource;
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
