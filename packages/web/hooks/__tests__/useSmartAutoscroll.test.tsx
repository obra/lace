// ABOUTME: Tests for smart autoscroll functionality
// ABOUTME: Verifies autoscroll behavior for user messages, streaming, and scroll position tracking

import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useSmartAutoscroll, useTimelineAutoscroll } from '@/hooks/useSmartAutoscroll';
import { ScrollProvider } from '@/components/providers/ScrollProvider';
import type { LaceEvent } from '@/types/core';
import React from 'react';

// Mock scroll behavior
const createMockContainer = (scrollTop = 0, scrollHeight = 1000, clientHeight = 500) => {
  const container = {
    scrollTop,
    scrollHeight,
    clientHeight,
    scrollTo: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  // Mock getBoundingClientRect and other DOM methods as needed
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (value) => {
      scrollTop = value;
    },
  });

  return container;
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ScrollProvider>{children}</ScrollProvider>
);

describe('useSmartAutoscroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect when user is near bottom', () => {
    const { result } = renderHook(() => useSmartAutoscroll({ nearBottomThreshold: 100 }));

    // Mock container that's near bottom (90px from bottom)
    const mockContainer = createMockContainer(410, 1000, 500);
    Object.defineProperty(result.current.containerRef, 'current', {
      value: mockContainer,
      writable: true,
    });

    expect(result.current.isNearBottom()).toBe(true);

    // Mock container that's far from bottom (200px from bottom)
    const mockContainerFar = createMockContainer(300, 1000, 500);
    Object.defineProperty(result.current.containerRef, 'current', {
      value: mockContainerFar,
      writable: true,
    });

    expect(result.current.isNearBottom()).toBe(false);
  });

  it('should scroll to bottom when forced', async () => {
    const { result } = renderHook(() => useSmartAutoscroll({ scrollDelay: 0 }));

    const mockContainer = createMockContainer(0, 1000, 500);
    Object.defineProperty(result.current.containerRef, 'current', {
      value: mockContainer,
      writable: true,
    });

    act(() => {
      result.current.scrollToBottom(true);
    });

    // Wait for scroll to trigger
    await waitFor(() =>
      expect(mockContainer.scrollTo).toHaveBeenCalledWith({
        top: 1000,
        behavior: 'smooth',
      })
    );
  });
});

describe('useTimelineAutoscroll', () => {
  it('should trigger autoscroll on new user messages', async () => {
    const mockEvents = [{ type: 'AGENT_MESSAGE', content: 'Hello' }];

    const { result, rerender } = renderHook(
      ({ events }) => useTimelineAutoscroll(events, false, undefined, { scrollDelay: 0 }),
      {
        wrapper,
        initialProps: { events: mockEvents },
      }
    );

    const mockContainer = createMockContainer(410, 1000, 500); // Near bottom
    Object.defineProperty(result.current.containerRef, 'current', {
      value: mockContainer,
      writable: true,
    });

    // Add a user message
    const newEvents = [...mockEvents, { type: 'USER_MESSAGE', content: 'How are you?' }];

    act(() => {
      rerender({ events: newEvents });
    });

    // Should trigger scroll due to user message
    await waitFor(() => expect(mockContainer.scrollTo).toHaveBeenCalled());
  });

  it('should handle streaming content updates', async () => {
    const mockEvents: LaceEvent[] = [
      {
        type: 'USER_MESSAGE',
        data: 'Hello',
        timestamp: new Date(),
        context: { threadId: 'test-thread' },
      },
    ];

    const { result, rerender } = renderHook(
      ({ events }: { events: LaceEvent[] }) =>
        useTimelineAutoscroll(events, false, undefined, { scrollDelay: 0 }),
      {
        wrapper,
        initialProps: { events: mockEvents },
      }
    );

    const mockContainer = createMockContainer(410, 1000, 500);
    Object.defineProperty(result.current.containerRef, 'current', {
      value: mockContainer,
      writable: true,
    });

    // Start streaming by adding AGENT_STREAMING event
    const eventsWithStreaming: LaceEvent[] = [
      ...mockEvents,
      {
        type: 'AGENT_STREAMING',
        data: { content: 'Streaming...' },
        timestamp: new Date(),
        context: { threadId: 'test-thread' },
      },
    ];
    act(() => {
      rerender({ events: eventsWithStreaming });
    });

    await waitFor(() => expect(mockContainer.scrollTo).toHaveBeenCalled());
  });

  it('should autoscroll when content is first loaded', async () => {
    const { result, rerender } = renderHook(
      ({ events }: { events: unknown[] }) =>
        useTimelineAutoscroll(events, false, undefined, { scrollDelay: 0 }),
      {
        wrapper,
        initialProps: { events: [] as unknown[] },
      }
    );

    const mockContainer = createMockContainer(0, 1000, 500);
    Object.defineProperty(result.current.containerRef, 'current', {
      value: mockContainer as Partial<HTMLElement>,
      writable: true,
    });

    // Simulate loading content from server
    const loadedEvents = [
      { type: 'USER_MESSAGE', content: 'Hello' },
      { type: 'AGENT_MESSAGE', content: 'Hi there!' },
    ];

    // Rerender with loaded events
    act(() => {
      rerender({ events: loadedEvents });
    });

    await waitFor(() =>
      expect(mockContainer.scrollTo).toHaveBeenCalledWith({
        top: 1000,
        behavior: 'smooth',
      })
    );
  });
});
