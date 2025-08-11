// ABOUTME: Unit tests for useEventStream hook agent state change handling
// ABOUTME: Tests AGENT_STATE_CHANGE event processing and callback invocation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventStream } from './useEventStream';
import type { SessionEvent } from '@/types/web-sse';
// StreamEvent removed - using ThreadEvent directly
import { stringify } from '@/lib/serialization';
import { asThreadId } from '~/threads/types';

// Mock logger to suppress intentional error messages during testing
vi.mock('~/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock EventSource since it's not available in Node.js test environment
class MockEventSource {
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = EventSource.CONNECTING;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening after a short delay
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN;
      this.onopen?.(new Event('open'));
    }, 10);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  // Test helper method to simulate receiving events
  simulateMessage(data: unknown) {
    if (this.onmessage && this.readyState === MockEventSource.OPEN) {
      // EventSource sends data as superjson strings (same as EventStreamManager)
      const event = new MessageEvent('message', {
        data: stringify(data),
      });
      this.onmessage(event);
    }
  }

  // Test helper method to simulate errors
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Make EventSource available globally
Object.defineProperty(global, 'EventSource', {
  value: MockEventSource,
  writable: true,
});

describe('useEventStream agent state change handling', () => {
  let mockEventSource: MockEventSource;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console.error to suppress intentional error logging during error handling tests
    console.error = vi.fn();

    // Intercept EventSource creation to get reference to mock
    const OriginalEventSource = global.EventSource;
    global.EventSource = vi.fn().mockImplementation((url: string) => {
      mockEventSource = new MockEventSource(url);
      return mockEventSource;
    }) as unknown as typeof EventSource;
  });

  afterEach(() => {
    if (mockEventSource) {
      mockEventSource.close();
    }
    // Restore console.error
    console.error = originalConsoleError;
    vi.restoreAllMocks();
  });

  it('should call onAgentStateChange callback when AGENT_STATE_CHANGE event is received', async () => {
    // Arrange: Set up the hook with a mock callback
    const mockOnAgentStateChange = vi.fn();

    const { result } = renderHook(() =>
      useEventStream({
        sessionId: 'test-session',
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Wait for connection to establish
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Verify connection is established
    expect(result.current.connection.connected).toBe(true);

    // Act: Simulate receiving an AGENT_STATE_CHANGE event
    const mockStreamEvent = {
      id: 'event-123',
      eventType: 'session',
      timestamp: new Date(),
      scope: { sessionId: 'test-session' },
      data: {
        type: 'AGENT_STATE_CHANGE',
        threadId: asThreadId('lace_20250101_agent1'),
        timestamp: new Date(),
        data: {
          agentId: asThreadId('lace_20250101_agent1'),
          from: 'idle',
          to: 'thinking',
        },
      } satisfies SessionEvent,
    };

    await act(async () => {
      mockEventSource.simulateMessage(mockStreamEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Assert: Verify the callback was called with correct parameters
    expect(mockOnAgentStateChange).toHaveBeenCalledTimes(1);
    expect(mockOnAgentStateChange).toHaveBeenCalledWith(
      asThreadId('lace_20250101_agent1'),
      'idle',
      'thinking'
    );
  });

  it('should handle multiple agent state transitions correctly', async () => {
    // Arrange: Set up the hook with a mock callback
    const mockOnAgentStateChange = vi.fn();

    const { result } = renderHook(() =>
      useEventStream({
        sessionId: 'test-session',
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Wait for connection to establish
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Act: Simulate multiple state transitions
    const transitions = [
      { agentId: asThreadId('lace_20250101_agent1'), from: 'idle', to: 'thinking' },
      { agentId: asThreadId('lace_20250101_agent1'), from: 'thinking', to: 'streaming' },
      { agentId: asThreadId('lace_20250101_agent1'), from: 'streaming', to: 'tool_execution' },
      { agentId: asThreadId('lace_20250101_agent1'), from: 'tool_execution', to: 'idle' },
    ];

    for (const transition of transitions) {
      const mockStreamEvent = {
        id: `event-${Date.now()}`,
        eventType: 'session',
        timestamp: new Date(),
        scope: { sessionId: 'test-session' },
        data: {
          type: 'AGENT_STATE_CHANGE',
          threadId: transition.agentId,
          timestamp: new Date(),
          data: transition,
        } satisfies SessionEvent,
      };

      await act(async () => {
        mockEventSource.simulateMessage(mockStreamEvent);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    // Assert: Verify all transitions were processed
    expect(mockOnAgentStateChange).toHaveBeenCalledTimes(4);
    expect(mockOnAgentStateChange).toHaveBeenNthCalledWith(
      1,
      asThreadId('lace_20250101_agent1'),
      'idle',
      'thinking'
    );
    expect(mockOnAgentStateChange).toHaveBeenNthCalledWith(
      2,
      asThreadId('lace_20250101_agent1'),
      'thinking',
      'streaming'
    );
    expect(mockOnAgentStateChange).toHaveBeenNthCalledWith(
      3,
      asThreadId('lace_20250101_agent1'),
      'streaming',
      'tool_execution'
    );
    expect(mockOnAgentStateChange).toHaveBeenNthCalledWith(
      4,
      asThreadId('lace_20250101_agent1'),
      'tool_execution',
      'idle'
    );
  });

  it('should handle multiple agents with different state changes', async () => {
    // Arrange: Set up the hook with a mock callback
    const mockOnAgentStateChange = vi.fn();

    const { result } = renderHook(() =>
      useEventStream({
        sessionId: 'test-session',
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Wait for connection to establish
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Act: Simulate state changes for different agents
    const agent1Event = {
      id: 'event-1',
      eventType: 'session',
      timestamp: new Date(),
      scope: { sessionId: 'test-session' },
      data: {
        type: 'AGENT_STATE_CHANGE',
        threadId: asThreadId('lace_20250101_agent2'),
        timestamp: new Date(),
        data: {
          agentId: asThreadId('lace_20250101_agent2'),
          from: 'idle',
          to: 'thinking',
        },
      } satisfies SessionEvent,
    };

    const agent2Event = {
      id: 'event-2',
      eventType: 'session',
      timestamp: new Date(),
      scope: { sessionId: 'test-session' },
      data: {
        type: 'AGENT_STATE_CHANGE',
        threadId: asThreadId('lace_20250101_agent3'),
        timestamp: new Date(),
        data: {
          agentId: asThreadId('lace_20250101_agent3'),
          from: 'idle',
          to: 'streaming',
        },
      } satisfies SessionEvent,
    };

    await act(async () => {
      mockEventSource.simulateMessage(agent1Event);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await act(async () => {
      mockEventSource.simulateMessage(agent2Event);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Assert: Verify both agents' state changes were processed
    expect(mockOnAgentStateChange).toHaveBeenCalledTimes(2);
    expect(mockOnAgentStateChange).toHaveBeenNthCalledWith(
      1,
      asThreadId('lace_20250101_agent2'),
      'idle',
      'thinking'
    );
    expect(mockOnAgentStateChange).toHaveBeenNthCalledWith(
      2,
      asThreadId('lace_20250101_agent3'),
      'idle',
      'streaming'
    );
  });

  it('should not call onAgentStateChange for non-AGENT_STATE_CHANGE events', async () => {
    // Arrange: Set up the hook with a mock callback
    const mockOnAgentStateChange = vi.fn();

    const { result } = renderHook(() =>
      useEventStream({
        sessionId: 'test-session',
        onAgentStateChange: mockOnAgentStateChange,
      })
    );

    // Wait for connection to establish
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Act: Simulate receiving other types of session events
    const otherEvents = [
      {
        type: 'USER_MESSAGE',
        data: { content: 'Hello' },
      },
      {
        type: 'AGENT_MESSAGE',
        data: { content: 'Hi there' },
      },
      {
        type: 'TOOL_CALL',
        data: { id: 'call-123', name: 'test_tool', arguments: {} },
      },
    ];

    for (const eventData of otherEvents) {
      const mockStreamEvent = {
        id: `event-${Date.now()}`,
        eventType: 'session',
        timestamp: new Date(),
        scope: { sessionId: 'test-session' },
        data: {
          ...eventData,
          threadId: asThreadId('lace_20250101_agent1'),
          timestamp: new Date(),
        } as SessionEvent,
      };

      await act(async () => {
        mockEventSource.simulateMessage(mockStreamEvent);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    // Assert: onAgentStateChange should not have been called
    expect(mockOnAgentStateChange).not.toHaveBeenCalled();
  });

  it('should handle malformed AGENT_STATE_CHANGE events gracefully', async () => {
    // Arrange: Set up the hook with mock callbacks
    const mockOnAgentStateChange = vi.fn();
    const mockOnError = vi.fn();

    const { result } = renderHook(() =>
      useEventStream({
        sessionId: 'test-session',
        onAgentStateChange: mockOnAgentStateChange,
        onError: mockOnError,
      })
    );

    // Wait for connection to establish
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Act: Simulate receiving a malformed AGENT_STATE_CHANGE event
    const malformedEvent = {
      id: 'event-123',
      eventType: 'session',
      timestamp: new Date(),
      scope: { sessionId: 'test-session' },
      data: {
        type: 'AGENT_STATE_CHANGE',
        threadId: asThreadId('lace_20250101_agent1'),
        timestamp: new Date(),
        data: {
          // Missing required fields
          agentId: asThreadId('lace_20250101_agent1'),
          // from and to are missing
        },
      } as SessionEvent,
    };

    await act(async () => {
      mockEventSource.simulateMessage(malformedEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Assert: Should handle the error and not crash
    expect(mockOnAgentStateChange).not.toHaveBeenCalled();
    // The hook should continue working after the error
    expect(result.current.connection.connected).toBe(true);
  });

  it('should not call onAgentStateChange when callback is undefined', async () => {
    // Arrange: Set up the hook without onAgentStateChange callback
    const { result } = renderHook(() =>
      useEventStream({
        sessionId: 'test-session',
        // No onAgentStateChange callback provided
      })
    );

    // Wait for connection to establish
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Act: Simulate receiving an AGENT_STATE_CHANGE event
    const mockStreamEvent = {
      id: 'event-123',
      eventType: 'session',
      timestamp: new Date(),
      scope: { sessionId: 'test-session' },
      data: {
        type: 'AGENT_STATE_CHANGE',
        threadId: asThreadId('lace_20250101_agent1'),
        timestamp: new Date(),
        data: {
          agentId: asThreadId('lace_20250101_agent1'),
          from: 'idle',
          to: 'thinking',
        },
      } satisfies SessionEvent,
    };

    await act(async () => {
      mockEventSource.simulateMessage(mockStreamEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Assert: Should not throw any errors - this is a smoke test
    expect(result.current.connection.connected).toBe(true);
  });
});
