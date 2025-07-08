// ABOUTME: Tests for timeline window resume behavior and bottom positioning
// ABOUTME: Verifies timeline jumps to bottom when loading historical events

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineWindow } from '~/interfaces/terminal/components/events/hooks/useTimelineWindow.js';
import { Timeline } from '~/interfaces/timeline-types.js';

describe('useTimelineWindow - Resume Behavior', () => {
  const createTimeline = (itemCount: number): Timeline => ({
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `item-${i}`,
      type: 'user_message' as const,
      timestamp: new Date(Date.now() + i * 1000),
      content: `Message ${i}`,
    })),
    metadata: {
      eventCount: itemCount,
      messageCount: itemCount,
      lastActivity: new Date(),
    },
  });

  it('should start at bottom when timeline has initial items', () => {
    const timeline = createTimeline(100);

    const { result } = renderHook(() =>
      useTimelineWindow({
        timeline,
        viewportHeight: 30,
        windowSize: 50,
      })
    );

    // Should select last item
    expect(result.current.selectedItemIndex).toBe(99);
    // Window should be positioned to show last items
    expect(result.current.windowStartIndex).toBe(50); // 100 - 50
  });

  it('should handle timeline starting empty then loading items', () => {
    // Start with empty timeline
    let timeline = createTimeline(0);

    const { result, rerender } = renderHook(
      ({ timeline }) =>
        useTimelineWindow({
          timeline,
          viewportHeight: 30,
          windowSize: 50,
        }),
      { initialProps: { timeline } }
    );

    // Initially at -1 (empty)
    expect(result.current.selectedItemIndex).toBe(-1);
    expect(result.current.windowStartIndex).toBe(0);

    // Simulate loading historical events
    timeline = createTimeline(100);
    rerender({ timeline });

    // Should automatically jump to bottom when going from empty to non-empty (resume case)
    expect(result.current.selectedItemIndex).toBe(99);
    expect(result.current.windowStartIndex).toBe(50); // 100 - 50
  });

  it('should update position when timeline grows from non-empty state', () => {
    // Start with some items
    let timeline = createTimeline(50);

    const { result, rerender } = renderHook(
      ({ timeline }) =>
        useTimelineWindow({
          timeline,
          viewportHeight: 30,
          windowSize: 50,
        }),
      { initialProps: { timeline } }
    );

    // Initially at bottom
    expect(result.current.selectedItemIndex).toBe(49);
    expect(result.current.windowStartIndex).toBe(0); // All items fit in window

    // Add more items
    timeline = createTimeline(60);
    rerender({ timeline });

    // Should follow to new bottom because we were at the end
    expect(result.current.selectedItemIndex).toBe(59);
    expect(result.current.windowStartIndex).toBe(10); // 60 - 50
  });

  it('should not follow when not at bottom', () => {
    // Start with items
    let timeline = createTimeline(100);

    const { result, rerender } = renderHook(
      ({ timeline }) =>
        useTimelineWindow({
          timeline,
          viewportHeight: 30,
          windowSize: 50,
        }),
      { initialProps: { timeline } }
    );

    // Navigate away from bottom
    act(() => {
      result.current.jumpToItem(50);
    });

    expect(result.current.selectedItemIndex).toBe(50);

    // Add more items
    timeline = createTimeline(110);
    rerender({ timeline });

    // Should stay at current position
    expect(result.current.selectedItemIndex).toBe(50);
  });

  it('should handle jumpToEnd on resume', () => {
    // Empty timeline
    const emptyTimeline = createTimeline(0);

    const { result, rerender } = renderHook(
      ({ timeline }) =>
        useTimelineWindow({
          timeline,
          viewportHeight: 30,
          windowSize: 50,
        }),
      { initialProps: { timeline: emptyTimeline } }
    );

    // Load historical events
    const loadedTimeline = createTimeline(200);
    rerender({ timeline: loadedTimeline });

    // Manually jump to end after loading
    act(() => {
      result.current.jumpToEnd();
    });

    expect(result.current.selectedItemIndex).toBe(199);
    expect(result.current.windowStartIndex).toBe(150); // 200 - 50
  });
});
