// ABOUTME: Tests for useTimelineWindow hook - line-based scrolling
// ABOUTME: Verifies scrolling, navigation, and measurement behavior

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineWindow } from '~/interfaces/terminal/components/events/hooks/useTimelineWindow.js';
import { Timeline } from '~/interfaces/timeline-types.js';

function createMockTimeline(itemCount: number): Timeline {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    type: 'user_message' as const,
    id: `msg-${i}`,
    content: `Message ${i}`,
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
  };

  describe('initialization', () => {
    it('initializes at bottom of timeline', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      expect(result.current.selectedItemIndex).toBe(99); // Last item
      expect(result.current.selectedLineInItem).toBe(0);
      // ScrollTop will be > 0 to show bottom items (100 items - viewport height)
    });

    it('handles timeline smaller than viewport', () => {
      const timeline = createMockTimeline(20);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      expect(result.current.selectedItemIndex).toBe(19);
      expect(result.current.scrollTop).toBe(0);
    });

    it('handles empty timeline', () => {
      const timeline = createMockTimeline(0);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      expect(result.current.selectedItemIndex).toBe(-1);
      expect(result.current.scrollTop).toBe(0);
      expect(result.current.innerHeight).toBe(0);
    });
  });

  describe('line navigation', () => {
    it('scrolls when cursor reaches viewport edges', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, viewportHeight: 10 }));

      // Set item heights (each item is 2 lines)
      act(() => {
        const heights = new Map<number, number>();
        for (let i = 0; i < 100; i++) {
          heights.set(i, 2);
        }
        result.current.setItemHeights(heights);
      });

      // Jump to middle
      act(() => {
        result.current.jumpToItem(50);
      });

      const initialScroll = result.current.scrollTop;

      // Navigate down - should scroll when cursor reaches bottom
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.navigateToNextLine();
        }
      });

      expect(result.current.scrollTop).toBeGreaterThan(initialScroll);
    });

    it('navigates lines within an item', () => {
      const timeline = createMockTimeline(10);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Set item heights
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

      // Navigate to previous line
      act(() => {
        result.current.navigateToPreviousLine();
      });

      expect(result.current.selectedItemIndex).toBe(4);
      expect(result.current.selectedLineInItem).toBe(2); // Last line of item 4
    });
  });

  describe('page navigation', () => {
    it('navigates by viewport height', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() =>
        useTimelineWindow({ timeline, viewportHeight: 10 })
      );

      // Set uniform heights
      act(() => {
        const heights = new Map<number, number>();
        for (let i = 0; i < 100; i++) {
          heights.set(i, 1);
        }
        result.current.setItemHeights(heights);
      });

      // Start at bottom
      expect(result.current.selectedItemIndex).toBe(99);

      // Page up should scroll up by viewport height
      const initialScroll = result.current.scrollTop;
      act(() => {
        result.current.navigatePageUp();
      });

      expect(result.current.scrollTop).toBe(Math.max(0, initialScroll - 10));
    });

    it('clamps page navigation to valid range', () => {
      const timeline = createMockTimeline(5);
      const { result } = renderHook(() =>
        useTimelineWindow({ timeline, viewportHeight: 30 })
      );

      // Page up from bottom
      act(() => {
        result.current.navigatePageUp();
      });

      expect(result.current.selectedItemIndex).toBe(0);
      expect(result.current.scrollTop).toBe(0);
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
      expect(result.current.selectedLineInItem).toBe(0);
      expect(result.current.scrollTop).toBe(0);
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
    });

    it('jumps to specific item', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      act(() => {
        result.current.jumpToItem(42);
      });

      expect(result.current.selectedItemIndex).toBe(42);
      expect(result.current.selectedLineInItem).toBe(0);
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

      // Set heights
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

      // Jump to start
      act(() => {
        result.current.jumpToStart();
      });

      // Navigate to item 2, line 1
      act(() => {
        result.current.jumpToItem(2);
        result.current.navigateToNextLine();
      });

      // Cursor should be at: item 0 (3) + item 1 (5) + line 1 = 9
      const absoluteLine = result.current.getCursorAbsoluteLine();
      expect(absoluteLine).toBe(9);
      
      // Viewport position depends on scroll
      const viewportLine = result.current.getCursorViewportLine();
      expect(viewportLine).toBe(absoluteLine - result.current.scrollTop);
    });
  });

  describe('scrolling behavior', () => {
    it('returns all items for rendering', () => {
      const timeline = createMockTimeline(100);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      const items = result.current.getWindowItems();
      expect(items.length).toBe(100); // All items
      expect(items[0]).toBe(timeline.items[0]);
      expect(items[99]).toBe(timeline.items[99]);
    });

    it('updates item positions when heights change', () => {
      const timeline = createMockTimeline(5);
      const { result } = renderHook(() => useTimelineWindow({ timeline, ...defaultOptions }));

      // Set heights
      act(() => {
        result.current.setItemHeights(
          new Map([
            [0, 3],
            [1, 5],
            [2, 2],
            [3, 4],
            [4, 3],
          ])
        );
      });

      // Check positions are calculated correctly
      expect(result.current.itemPositions.get(0)).toBe(0);
      expect(result.current.itemPositions.get(1)).toBe(3);
      expect(result.current.itemPositions.get(2)).toBe(8);
      expect(result.current.itemPositions.get(3)).toBe(10);
      expect(result.current.itemPositions.get(4)).toBe(14);
      
      // Total height
      expect(result.current.innerHeight).toBe(17);
    });
  });
});