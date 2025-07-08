// ABOUTME: Tests for useTimelineWindow hook - sliding window virtualization
// ABOUTME: Verifies window positioning, navigation, and measurement behavior

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineWindow } from '~/interfaces/terminal/components/events/hooks/useTimelineWindow.js';
import { Timeline } from '~/interfaces/timeline-types.js';

function createMockTimeline(itemCount: number): Timeline {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    type: 'user_message' as const,
    id: `msg-${i}`,
    sender: 'user',
    text: `Message ${i}`,
    timestamp: new Date(Date.now() - (itemCount - i) * 1000),
  }));

  return {
    items,
    metadata: {
      eventCount: itemCount,
      messageCount: itemCount,
      lastActivity: new Date(),
    },
  };
}

describe('useTimelineWindow', () => {
  const defaultOptions = {
    viewportHeight: 30,
    windowSize: 50,
    edgeThreshold: 5,
  };

  describe('initialization', () => {
    it('initializes window at bottom of timeline', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Window should show the last 50 items
      expect(result.current.windowStartIndex).toBe(50);
      expect(result.current.selectedItemIndex).toBe(99); // Last item
      expect(result.current.selectedLineInItem).toBe(0);
    });

    it('handles timeline smaller than window size', () => {
      const timeline = createMockTimeline(20);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      expect(result.current.windowStartIndex).toBe(0);
      expect(result.current.selectedItemIndex).toBe(19);
    });

    it('handles empty timeline', () => {
      const timeline = createMockTimeline(0);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      expect(result.current.windowStartIndex).toBe(0);
      expect(result.current.selectedItemIndex).toBe(-1);
    });
  });

  describe('item navigation', () => {
    it('slides window up when navigating to previous item', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Start at bottom (item 99, window starts at 50)
      expect(result.current.selectedItemIndex).toBe(99);
      expect(result.current.windowStartIndex).toBe(50);

      // Navigate up - window should slide to keep item centered
      act(() => {
        result.current.navigateToPreviousItem();
      });

      expect(result.current.selectedItemIndex).toBe(98);
      // Window can't slide past maxStart (100 - 50 = 50)
      // Even though ideal position would be 73 (98 - 25), it's clamped to 50
      expect(result.current.windowStartIndex).toBe(50);
    });

    it('slides window down when navigating to next item', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Move to middle first
      act(() => {
        result.current.jumpToItem(50);
      });

      expect(result.current.windowStartIndex).toBe(25); // 50 - 25 = 25

      // Navigate down
      act(() => {
        result.current.navigateToNextItem();
      });

      expect(result.current.selectedItemIndex).toBe(51);
      expect(result.current.windowStartIndex).toBe(26); // Slides with selection
    });

    it('stops window at edges', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Jump to start
      act(() => {
        result.current.jumpToStart();
      });

      expect(result.current.selectedItemIndex).toBe(0);
      expect(result.current.windowStartIndex).toBe(0); // Can't go negative

      // Navigate up (should do nothing)
      act(() => {
        result.current.navigateToPreviousItem();
      });

      expect(result.current.selectedItemIndex).toBe(0);
      expect(result.current.windowStartIndex).toBe(0);
    });
  });

  describe('line navigation within items', () => {
    it('navigates lines within an item', () => {
      const timeline = createMockTimeline(10);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Set item heights (simulate measurement)
      act(() => {
        result.current.setItemHeights(
          new Map([
            [9, 5], // Last item has 5 lines
          ])
        );
      });

      // Navigate within item
      act(() => {
        result.current.navigateToNextLine();
      });

      expect(result.current.selectedItemIndex).toBe(9); // Same item
      expect(result.current.selectedLineInItem).toBe(1); // Next line

      // Navigate to end of item
      act(() => {
        result.current.navigateToNextLine();
        result.current.navigateToNextLine();
        result.current.navigateToNextLine();
      });

      expect(result.current.selectedLineInItem).toBe(4); // Last line (0-indexed)

      // Next navigation should move to next item
      act(() => {
        result.current.navigateToNextLine();
      });

      expect(result.current.selectedItemIndex).toBe(9); // Can't go past last item
      expect(result.current.selectedLineInItem).toBe(4); // Stays on last line
    });

    it('moves to previous item when navigating up from first line', () => {
      const timeline = createMockTimeline(10);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Start at item 5
      act(() => {
        result.current.jumpToItem(5);
      });

      // Set item heights
      act(() => {
        result.current.setItemHeights(
          new Map([
            [4, 3], // Previous item has 3 lines
            [5, 2], // Current item has 2 lines
          ])
        );
      });

      // Navigate to previous line (should go to last line of previous item)
      act(() => {
        result.current.navigateToPreviousLine();
      });

      expect(result.current.selectedItemIndex).toBe(4);
      expect(result.current.selectedLineInItem).toBe(2); // Last line of item 4
    });
  });

  describe('page navigation', () => {
    it('navigates by viewport height on page up/down', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() =>
        useTimelineWindow({ timeline, viewportHeight: 10, windowSize: 50 })
      );

      // Start at bottom
      expect(result.current.selectedItemIndex).toBe(99);

      // Page up
      act(() => {
        result.current.navigatePageUp();
      });

      expect(result.current.selectedItemIndex).toBe(89); // 99 - 10
      // Window is still clamped to maxStart (100 - 50 = 50)
      expect(result.current.windowStartIndex).toBe(50);

      // Page down
      act(() => {
        result.current.navigatePageDown();
      });

      expect(result.current.selectedItemIndex).toBe(99); // Back to bottom
    });

    it('clamps page navigation to valid range', () => {
      const timeline = createMockTimeline(20);
      const { result } = renderHook(() =>
        useTimelineWindow({ timeline, viewportHeight: 30, windowSize: 50 })
      );

      // Page up from bottom (should go to top since viewport > items)
      act(() => {
        result.current.navigatePageUp();
      });

      expect(result.current.selectedItemIndex).toBe(0);
    });
  });

  describe('jump navigation', () => {
    it('jumps to start of timeline', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      act(() => {
        result.current.jumpToStart();
      });

      expect(result.current.selectedItemIndex).toBe(0);
      expect(result.current.windowStartIndex).toBe(0);
      expect(result.current.selectedLineInItem).toBe(0);
    });

    it('jumps to end of timeline', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Start at beginning
      act(() => {
        result.current.jumpToStart();
      });

      // Jump to end
      act(() => {
        result.current.jumpToEnd();
      });

      expect(result.current.selectedItemIndex).toBe(99);
      expect(result.current.windowStartIndex).toBe(50); // 100 - 50
    });

    it('jumps to specific item', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      act(() => {
        result.current.jumpToItem(42);
      });

      expect(result.current.selectedItemIndex).toBe(42);
      expect(result.current.windowStartIndex).toBe(17); // 42 - 25 (centered)
    });
  });

  describe('height management', () => {
    it('stores and retrieves item heights', () => {
      const timeline = createMockTimeline(10);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      const heights = new Map([
        [0, 3],
        [1, 5],
        [2, 2],
      ]);

      act(() => {
        result.current.setItemHeights(heights);
      });

      expect(result.current.itemHeights).toEqual(heights);
    });

    it('calculates cursor position within viewport', () => {
      const timeline = createMockTimeline(10);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Set heights for items in window
      act(() => {
        result.current.setItemHeights(
          new Map([
            [0, 3],
            [1, 5],
            [2, 2],
            [3, 4],
          ])
        );
      });

      // Select item 2, line 1
      act(() => {
        result.current.jumpToItem(2);
        result.current.navigateToNextLine();
      });

      // With window centered on item 2, window starts at 0 (since 2 - 25 = -23, clamped to 0)
      expect(result.current.windowStartIndex).toBe(0);
      // Cursor should be at line 3 + 5 + 1 = 9 in viewport
      // Actually: item 0 (3 lines) + item 1 (5 lines) + line 1 of item 2 = 8
      expect(result.current.getCursorViewportLine()).toBe(8);
    });
  });

  describe('window size calculation', () => {
    it('returns items in current window', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Jump to middle
      act(() => {
        result.current.jumpToItem(50);
      });

      const windowItems = result.current.getWindowItems();
      expect(windowItems.length).toBe(50); // Window size
      expect(windowItems[0]).toBe(timeline.items[25]);
      expect(windowItems[24]).toBe(timeline.items[49]); // Selected item
      expect(windowItems[49]).toBe(timeline.items[74]);
    });
  });
});
