// ABOUTME: Test suite for new useEventStream hook using firehose singleton
// ABOUTME: Validates React hook behavior with EventStreamFirehose integration

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useEventStream } from './useEventStream.new';
import { EventStreamFirehose } from '@/lib/event-stream-firehose';

// Mock the firehose
vi.mock('@/lib/event-stream-firehose', () => ({
  EventStreamFirehose: {
    getInstance: vi.fn(),
  },
}));

describe('useEventStream', () => {
  const mockFirehose = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getStats: vi.fn(),
  };

  beforeEach(() => {
    (EventStreamFirehose.getInstance as any).mockReturnValue(mockFirehose);
    mockFirehose.subscribe.mockClear();
    mockFirehose.unsubscribe.mockClear();
    mockFirehose.getStats.mockReturnValue({
      isConnected: true,
      subscriptionCount: 1,
      eventsReceived: 5,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('should subscribe to firehose on mount', () => {
    mockFirehose.subscribe.mockReturnValue('subscription-id');

    const { result } = renderHook(() =>
      useEventStream({
        threadIds: ['thread-1'],
        onUserMessage: vi.fn(),
      })
    );

    expect(mockFirehose.subscribe).toHaveBeenCalledWith(
      { threadIds: ['thread-1'] },
      expect.any(Function)
    );

    expect(result.current.connection.connected).toBe(true);
    expect(result.current.sendCount).toBe(5);
  });

  test('should unsubscribe on unmount', () => {
    mockFirehose.subscribe.mockReturnValue('subscription-id');

    const { unmount } = renderHook(() =>
      useEventStream({
        onUserMessage: vi.fn(),
      })
    );

    unmount();

    expect(mockFirehose.unsubscribe).toHaveBeenCalledWith('subscription-id');
  });

  test('should resubscribe when filter changes', () => {
    mockFirehose.subscribe.mockReturnValue('subscription-id-1');

    const { rerender } = renderHook((props) => useEventStream(props), {
      initialProps: { threadIds: ['thread-1'], onUserMessage: vi.fn() },
    });

    mockFirehose.subscribe.mockReturnValue('subscription-id-2');

    rerender({ threadIds: ['thread-2'], onUserMessage: vi.fn() });

    expect(mockFirehose.unsubscribe).toHaveBeenCalledWith('subscription-id-1');
    expect(mockFirehose.subscribe).toHaveBeenCalledWith(
      { threadIds: ['thread-2'] },
      expect.any(Function)
    );
  });

  test('should route events to correct handlers', () => {
    const onUserMessage = vi.fn();
    const onAgentMessage = vi.fn();

    mockFirehose.subscribe.mockImplementation((filter, callback) => {
      // Simulate receiving a USER_MESSAGE event
      const testEvent = {
        id: 'event-1',
        type: 'USER_MESSAGE',
        threadId: 'thread-1',
        data: 'Hello',
        timestamp: new Date(),
      };

      setTimeout(() => callback(testEvent), 0);
      return 'subscription-id';
    });

    const { result } = renderHook(() =>
      useEventStream({
        threadIds: ['thread-1'],
        onUserMessage,
        onAgentMessage,
      })
    );

    // Wait for async callback
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(onUserMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'USER_MESSAGE',
            data: 'Hello',
          })
        );
        expect(onAgentMessage).not.toHaveBeenCalled();
        resolve(undefined);
      }, 10);
    });
  });
});
