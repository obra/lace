// ABOUTME: Tests for useSSEStream hook
// ABOUTME: Verifies SSE connection management and event processing

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { ThreadId } from '@/types/api';

// Track created EventSource instances
let eventSourceInstances: MockEventSource[] = [];

// Mock EventSource
class MockEventSource {
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners: Map<string, ((event: MessageEvent) => void)[]> = new Map();

  constructor(url: string) {
    this.url = url;
    eventSourceInstances.push(this);
    // Simulate connection open
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  dispatchEvent(type: string, data: unknown) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const event = new MessageEvent(type, { data: JSON.stringify(data) });
      listeners.forEach((listener) => listener(event));
    }
  }

  close() {
    this.readyState = 2; // CLOSED
  }
}

describe('useSSEStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventSourceInstances = [];
    // Mock EventSource on both global and window
    (global as typeof globalThis & { EventSource?: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource;
    if (typeof window !== 'undefined') {
      (window as typeof window & { EventSource?: typeof EventSource }).EventSource =
        MockEventSource as unknown as typeof EventSource;
    }
  });

  afterEach(() => {
    // Clean up mocks
    const globalWithEventSource = global as typeof globalThis & {
      EventSource?: typeof EventSource;
    };
    if (globalWithEventSource.EventSource === (MockEventSource as unknown as typeof EventSource)) {
      delete globalWithEventSource.EventSource;
    }
    if (typeof window !== 'undefined') {
      const windowWithEventSource = window as typeof window & { EventSource?: typeof EventSource };
      if (
        windowWithEventSource.EventSource === (MockEventSource as unknown as typeof EventSource)
      ) {
        delete windowWithEventSource.EventSource;
      }
    }
    eventSourceInstances = [];
  });

  it('should initialize with disconnected state', () => {
    const { result } = renderHook(() => useSSEStream(null));

    expect(result.current.connected).toBe(false);
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it('should connect when sessionId is provided', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const { result } = renderHook(() => useSSEStream(sessionId));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    expect(result.current.error).toBe(null);
  });

  it('should handle incoming events', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const { result } = renderHook(() => useSSEStream(sessionId));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Get the EventSource instance created by the hook
    const eventSource = eventSourceInstances[eventSourceInstances.length - 1];

    // Simulate incoming events
    act(() => {
      eventSource.dispatchEvent('USER_MESSAGE', {
        type: 'USER_MESSAGE',
        threadId: sessionId,
        timestamp: new Date().toISOString(),
        data: { content: 'Hello' },
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      type: 'USER_MESSAGE',
      threadId: sessionId,
      data: { content: 'Hello' },
    });

    // Add another event
    act(() => {
      eventSource.dispatchEvent('AGENT_MESSAGE', {
        type: 'AGENT_MESSAGE',
        threadId: sessionId,
        timestamp: new Date().toISOString(),
        data: { content: 'Hi there!' },
      });
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[1].type).toBe('AGENT_MESSAGE');
  });

  it('should clear events when requested', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const { result } = renderHook(() => useSSEStream(sessionId));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Add some events
    const eventSource = eventSourceInstances[eventSourceInstances.length - 1];
    act(() => {
      eventSource.dispatchEvent('USER_MESSAGE', {
        type: 'USER_MESSAGE',
        threadId: sessionId,
        timestamp: new Date().toISOString(),
        data: { content: 'Hello' },
      });
    });

    expect(result.current.events).toHaveLength(1);

    // Clear events
    act(() => {
      result.current.clearEvents();
    });

    expect(result.current.events).toEqual([]);
  });

  it('should handle connection errors', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;

    // Mock EventSource to simulate error
    class ErrorEventSource extends MockEventSource {
      constructor(url: string) {
        super(url);
        setTimeout(() => {
          if (this.onerror) {
            this.onerror(new Event('error'));
          }
        }, 10);
      }
    }

    (global as typeof globalThis & { EventSource?: typeof EventSource }).EventSource =
      ErrorEventSource as unknown as typeof EventSource;
    if (typeof window !== 'undefined') {
      (window as typeof window & { EventSource?: typeof EventSource }).EventSource =
        ErrorEventSource as unknown as typeof EventSource;
    }

    const { result } = renderHook(() => useSSEStream(sessionId));

    await waitFor(() => {
      expect(result.current.connected).toBe(false);
      expect(result.current.error).toBe('Connection lost');
    });
  });

  it('should disconnect when sessionId becomes null', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const { result, rerender } = renderHook(({ id }) => useSSEStream(id), {
      initialProps: { id: sessionId },
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Change sessionId to null
    rerender({ id: null });

    await waitFor(() => {
      expect(result.current.connected).toBe(false);
    });
  });

  it('should reconnect when changing sessionId', async () => {
    const sessionId1 = 'lace_20250113_test123' as ThreadId;
    const sessionId2 = 'lace_20250113_test456' as ThreadId;

    const { result, rerender } = renderHook(({ id }) => useSSEStream(id), {
      initialProps: { id: sessionId1 },
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Add event to first session
    const eventSource1 = eventSourceInstances[eventSourceInstances.length - 1];
    act(() => {
      eventSource1.dispatchEvent('USER_MESSAGE', {
        type: 'USER_MESSAGE',
        threadId: sessionId1,
        timestamp: new Date().toISOString(),
        data: { content: 'Session 1' },
      });
    });

    expect(result.current.events).toHaveLength(1);

    // Change to second session
    rerender({ id: sessionId2 });

    // Events are NOT automatically cleared by the hook when switching sessions
    // The application layer (page.tsx) handles clearing events
    expect(result.current.events).toHaveLength(1);

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
  });

  it('should handle all event types', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const { result } = renderHook(() => useSSEStream(sessionId));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    const eventSource = eventSourceInstances[eventSourceInstances.length - 1];
    const eventTypes = [
      'USER_MESSAGE',
      'AGENT_MESSAGE',
      'TOOL_CALL',
      'TOOL_RESULT',
      'THINKING',
      'SYSTEM_MESSAGE',
      'LOCAL_SYSTEM_MESSAGE',
    ];

    // Send one of each event type
    act(() => {
      eventTypes.forEach((type, index) => {
        eventSource.dispatchEvent(type, {
          type,
          threadId: sessionId,
          timestamp: new Date().toISOString(),
          data: { test: `Event ${index}` },
        });
      });
    });

    expect(result.current.events).toHaveLength(eventTypes.length);
    eventTypes.forEach((type, index) => {
      expect(result.current.events[index].type).toBe(type);
    });
  });

  it('should clean up on unmount', async () => {
    const sessionId = 'lace_20250113_test123' as ThreadId;
    const { unmount } = renderHook(() => useSSEStream(sessionId));

    await waitFor(() => {
      expect(eventSourceInstances).toHaveLength(1);
      expect(eventSourceInstances[0].readyState).toBe(1); // OPEN
    });

    unmount();

    // EventSource should be closed after unmount
    expect(eventSourceInstances[0].readyState).toBe(2); // CLOSED
  });
});
