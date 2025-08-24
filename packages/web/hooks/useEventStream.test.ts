// ABOUTME: Test suite for useEventStream hook with firehose singleton architecture
// ABOUTME: Tests event routing and handler dispatch, not connection management

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useEventStream } from './useEventStream';
import type { UseEventStreamOptions } from './useEventStream';
import type {
  LaceEvent,
  ThreadId,
  AgentMessageData,
  ToolCall,
  AgentStateChangeData,
} from '@/types/core';

// Mock the firehose
vi.mock('@/lib/event-stream-firehose', () => ({
  EventStreamFirehose: {
    getInstance: vi.fn(),
  },
}));

// Import the mocked version
import { EventStreamFirehose } from '@/lib/event-stream-firehose';

describe('useEventStream', () => {
  // Create a typed mock that matches the interface we need
  const mockFirehose = {
    subscribe: vi.fn().mockReturnValue('mock-subscription-id'),
    unsubscribe: vi.fn(),
    getStats: vi.fn(),
    getSubscriptions: vi.fn().mockReturnValue(new Map()),
  };

  beforeEach(() => {
    vi.mocked(EventStreamFirehose.getInstance).mockReturnValue(
      mockFirehose as ReturnType<typeof EventStreamFirehose.getInstance>
    );
    mockFirehose.subscribe.mockClear();
    mockFirehose.unsubscribe.mockClear();
    mockFirehose.getStats.mockReturnValue({
      isConnected: true,
      subscriptionCount: 1,
      eventsReceived: 5,
      connectionUrl: null,
      connectedAt: null,
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
      expect.objectContaining({
        threadIds: ['lace_20250101_thread01'],
        projectIds: ['project-1'],
      }),
      expect.any(Function)
    );

    expect(result.current.connection.connected).toBe(true);
  });

  test('should call onAgentStateChange callback when AGENT_STATE_CHANGE event is received', async () => {
    const mockOnAgentStateChange = vi.fn();
    let capturedCallback: ((event: LaceEvent) => void) | null = null;

    mockFirehose.subscribe.mockImplementation((filter: any, callback: any) => {
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
    const agentStateChangeEvent: LaceEvent = {
      id: 'event-1',
      type: 'AGENT_STATE_CHANGE',
      threadId: 'lace_20250101_thread01' as ThreadId,
      transient: true,
      data: {
        agentId: 'lace_20250101_thread01' as ThreadId,
        from: 'idle',
        to: 'thinking',
      } as AgentStateChangeData,
      timestamp: new Date(),
    };

    expect(capturedCallback).toBeDefined();
    capturedCallback!(agentStateChangeEvent);

    expect(mockOnAgentStateChange).toHaveBeenCalledTimes(1);
    expect(mockOnAgentStateChange).toHaveBeenCalledWith(
      'lace_20250101_thread01',
      'idle',
      'thinking'
    );
  });

  test('should handle multiple event types correctly', async () => {
    const mockOnUserMessage = vi.fn();
    const mockOnAgentMessage = vi.fn();
    const mockOnToolCall = vi.fn();
    let capturedCallback: ((event: LaceEvent) => void) | null = null;

    mockFirehose.subscribe.mockImplementation((filter: any, callback: any) => {
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
      threadId: 'lace_20250101_thread01' as ThreadId,
      data: 'Hello',
      timestamp: new Date(),
    });

    // Test AGENT_MESSAGE
    const agentMessageEvent: LaceEvent = {
      id: 'event-2',
      type: 'AGENT_MESSAGE',
      threadId: 'lace_20250101_thread01' as ThreadId,
      data: {
        content: 'Hi there',
      } as AgentMessageData,
      timestamp: new Date(),
    };
    expect(capturedCallback).toBeDefined();
    capturedCallback!(agentMessageEvent);

    // Test TOOL_CALL
    const toolCallEvent: LaceEvent = {
      id: 'event-3',
      type: 'TOOL_CALL',
      threadId: 'lace_20250101_thread01' as ThreadId,
      data: {
        id: 'test-call-123',
        name: 'file-read',
        arguments: { path: '/path/to/file.txt' },
      } as ToolCall,
      timestamp: new Date(),
    };
    expect(capturedCallback).toBeDefined();
    capturedCallback!(toolCallEvent);

    expect(mockOnUserMessage).toHaveBeenCalledTimes(1);
    expect(mockOnAgentMessage).toHaveBeenCalledTimes(1);
    expect(mockOnToolCall).toHaveBeenCalledTimes(1);
  });

  test('should handle malformed AGENT_STATE_CHANGE events gracefully', () => {
    const mockOnAgentStateChange = vi.fn();
    let capturedCallback: ((event: LaceEvent) => void) | null = null;

    mockFirehose.subscribe.mockImplementation((filter: any, callback: any) => {
      capturedCallback = callback;
      return 'subscription-id';
    });

    const { result } = renderHook(() =>
      useEventStream({
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Send malformed event (missing required agentId field)
    const malformedEvent: LaceEvent = {
      id: 'event-1',
      type: 'AGENT_STATE_CHANGE',
      threadId: 'lace_20250101_thread01' as ThreadId,
      transient: true,
      data: {
        from: 'idle',
        to: 'thinking',
        // Missing required agentId field to test error handling
      } as AgentStateChangeData,
      timestamp: new Date(),
    };
    expect(capturedCallback).toBeDefined();
    capturedCallback!(malformedEvent);

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
