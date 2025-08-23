// ABOUTME: Test suite for useEventStream hook with firehose singleton architecture
// ABOUTME: Tests event routing and handler dispatch, not connection management

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useEventStream } from './useEventStream';
import type { UseEventStreamOptions } from './useEventStream';
import { EventStreamFirehose } from '@/lib/event-stream-firehose';
import type { LaceEvent } from '@/types/core';

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
    (EventStreamFirehose.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockFirehose);
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

  test('should subscribe to firehose on mount with correct filter', () => {
    mockFirehose.subscribe.mockReturnValue('subscription-id');

    const { result } = renderHook(() =>
      useEventStream({
        threadIds: ['lace_20250101_thread01'],
        projectId: 'project-1',
        onUserMessage: vi.fn(),
      })
    );

    expect(mockFirehose.subscribe).toHaveBeenCalledWith(
      {
        threadIds: ['lace_20250101_thread01'],
        projectIds: ['project-1'],
        sessionIds: undefined,
        eventTypes: undefined,
      },
      expect.any(Function)
    );

    expect(result.current.connection.connected).toBe(true);
  });

  test('should call onAgentStateChange callback when AGENT_STATE_CHANGE event is received', async () => {
    const mockOnAgentStateChange = vi.fn();
    let capturedCallback: ((event: LaceEvent) => void) | null = null;

    mockFirehose.subscribe.mockImplementation((filter, callback) => {
      capturedCallback = callback;
      return 'subscription-id';
    });

    renderHook(() =>
      useEventStream({
        threadIds: ['lace_20250101_thread01'],
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Simulate receiving an AGENT_STATE_CHANGE event
    const agentStateChangeEvent = {
      id: 'event-1',
      type: 'AGENT_STATE_CHANGE',
      threadId: 'lace_20250101_thread01',
      data: {
        agentId: 'agent-123',
        from: 'idle',
        to: 'thinking',
      },
      timestamp: new Date(),
    } as LaceEvent;

    expect(capturedCallback).toBeDefined();
    capturedCallback!(agentStateChangeEvent);

    expect(mockOnAgentStateChange).toHaveBeenCalledTimes(1);
    expect(mockOnAgentStateChange).toHaveBeenCalledWith('agent-123', 'idle', 'thinking');
  });

  test('should handle multiple event types correctly', async () => {
    const mockOnUserMessage = vi.fn();
    const mockOnAgentMessage = vi.fn();
    const mockOnToolCall = vi.fn();
    let capturedCallback: ((event: LaceEvent) => void) | null = null;

    mockFirehose.subscribe.mockImplementation((filter, callback) => {
      capturedCallback = callback;
      return 'subscription-id';
    });

    renderHook(() =>
      useEventStream({
        onUserMessage: mockOnUserMessage,
        onAgentMessage: mockOnAgentMessage,
        onToolCall: mockOnToolCall,
      })
    );

    // Test USER_MESSAGE
    expect(capturedCallback).toBeDefined();
    capturedCallback!({
      id: 'event-1',
      type: 'USER_MESSAGE',
      threadId: 'lace_20250101_thread01',
      data: 'Hello',
      timestamp: new Date(),
    });

    // Test AGENT_MESSAGE
    expect(capturedCallback).toBeDefined();
    capturedCallback!({
      id: 'event-2',
      type: 'AGENT_MESSAGE',
      threadId: 'lace_20250101_thread01',
      data: 'Hi there',
      timestamp: new Date(),
    } as unknown as LaceEvent);

    // Test TOOL_CALL
    expect(capturedCallback).toBeDefined();
    capturedCallback!({
      id: 'event-3',
      type: 'TOOL_CALL',
      threadId: 'lace_20250101_thread01',
      data: { tool: 'search', args: {} },
      timestamp: new Date(),
    } as unknown as LaceEvent);

    expect(mockOnUserMessage).toHaveBeenCalledTimes(1);
    expect(mockOnAgentMessage).toHaveBeenCalledTimes(1);
    expect(mockOnToolCall).toHaveBeenCalledTimes(1);
  });

  test('should handle malformed AGENT_STATE_CHANGE events gracefully', () => {
    const mockOnAgentStateChange = vi.fn();
    let capturedCallback: ((event: LaceEvent) => void) | null = null;

    mockFirehose.subscribe.mockImplementation((filter, callback) => {
      capturedCallback = callback;
      return 'subscription-id';
    });

    const { result } = renderHook(() =>
      useEventStream({
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Send malformed event
    expect(capturedCallback).toBeDefined();
    capturedCallback!({
      id: 'event-1',
      type: 'AGENT_STATE_CHANGE',
      threadId: 'lace_20250101_thread01',
      data: { invalid: 'data' }, // Missing required fields
      timestamp: new Date(),
    } as unknown as LaceEvent);

    // Should not call the callback with invalid data
    expect(mockOnAgentStateChange).not.toHaveBeenCalled();
    // Hook should still be working
    expect(result.current.connection.connected).toBe(true);
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

    const { rerender } = renderHook((props: UseEventStreamOptions) => useEventStream(props), {
      initialProps: { threadIds: ['thread-1'], onUserMessage: vi.fn() },
    });

    mockFirehose.subscribe.mockReturnValue('subscription-id-2');

    rerender({ threadIds: ['thread-2'], onUserMessage: vi.fn() });

    expect(mockFirehose.unsubscribe).toHaveBeenCalledWith('subscription-id-1');
    expect(mockFirehose.subscribe).toHaveBeenLastCalledWith(
      {
        threadIds: ['thread-2'],
        projectIds: undefined,
        sessionIds: undefined,
        eventTypes: undefined,
      },
      expect.any(Function)
    );
  });

  test('should provide backward-compatible API', () => {
    mockFirehose.subscribe.mockReturnValue('subscription-id');

    const { result } = renderHook(() =>
      useEventStream({
        threadIds: ['lace_20250101_thread01'],
        onUserMessage: vi.fn(),
        // These should be ignored but not break anything
        autoReconnect: true,
        reconnectInterval: 5000,
      })
    );

    // Should provide expected API shape
    expect(result.current).toMatchObject({
      connection: {
        connected: expect.any(Boolean),
        reconnectAttempts: expect.any(Number),
        maxReconnectAttempts: expect.any(Number),
      },
      sendCount: expect.any(Number),
      close: expect.any(Function),
      reconnect: expect.any(Function),
    });
  });
});
