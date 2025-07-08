// ABOUTME: Sliding window state management for timeline virtualization
// ABOUTME: Replaces line-based navigation with item-based + window management

import { useState, useCallback, useRef, useEffect } from 'react';
import { Timeline, TimelineItem } from '~/interfaces/timeline-types.js';

export interface UseTimelineWindowOptions {
  timeline: Timeline;
  viewportHeight: number; // Terminal lines available
  windowSize?: number; // Items to render (default: 50)
  edgeThreshold?: number; // Items from edge before sliding (default: 5) - not used in smooth scrolling
}

export interface TimelineWindowState {
  // Selection state
  selectedItemIndex: number;
  selectedLineInItem: number;

  // Window state
  windowStartIndex: number;
  windowSize: number;

  // Measurements (only for rendered items)
  itemHeights: Map<number, number>;

  // Navigation methods
  navigateToPreviousLine: () => void;
  navigateToNextLine: () => void;
  navigateToPreviousItem: () => void;
  navigateToNextItem: () => void;
  navigatePageUp: () => void;
  navigatePageDown: () => void;
  jumpToStart: () => void;
  jumpToEnd: () => void;
  jumpToItem: (index: number) => void;

  // Height management
  setItemHeights: (heights: Map<number, number>) => void;

  // Utility methods
  getWindowItems: () => TimelineItem[];
  getCursorViewportLine: () => number;
}

export function useTimelineWindow({
  timeline,
  viewportHeight,
  windowSize = 50,
}: UseTimelineWindowOptions): TimelineWindowState {
  // Initialize at bottom of timeline
  const initialItemIndex = timeline.items.length > 0 ? timeline.items.length - 1 : -1;
  const initialWindowStart = Math.max(0, timeline.items.length - windowSize);

  const [selectedItemIndex, setSelectedItemIndex] = useState(initialItemIndex);
  const [selectedLineInItem, setSelectedLineInItem] = useState(0);
  const [windowStartIndex, setWindowStartIndex] = useState(initialWindowStart);
  const [itemHeights, setItemHeights] = useState<Map<number, number>>(new Map());

  // Update window position to keep selected item centered
  const updateWindowForSelection = useCallback(
    (newSelectedIndex: number) => {
      if (timeline.items.length === 0) return;

      setWindowStartIndex(() => {
        // If timeline fits in window, start at 0
        if (timeline.items.length <= windowSize) {
          return 0;
        }

        const windowCenter = Math.floor(windowSize / 2);
        const idealStart = newSelectedIndex - windowCenter;

        // Clamp to valid range
        const minStart = 0;
        const maxStart = timeline.items.length - windowSize;

        return Math.max(minStart, Math.min(maxStart, idealStart));
      });
    },
    [timeline.items.length, windowSize]
  );

  // Navigate to a specific item (updates window to keep it centered)
  const navigateToItem = useCallback(
    (index: number, lineInItem = 0) => {
      if (timeline.items.length === 0) return;

      const clampedIndex = Math.max(0, Math.min(timeline.items.length - 1, index));
      setSelectedItemIndex(clampedIndex);
      setSelectedLineInItem(lineInItem);
      updateWindowForSelection(clampedIndex);
    },
    [timeline.items.length, updateWindowForSelection]
  );

  // Line navigation
  const navigateToPreviousLine = useCallback(() => {
    if (selectedLineInItem > 0) {
      // Move up within current item
      setSelectedLineInItem((prev) => prev - 1);
    } else if (selectedItemIndex > 0) {
      // Move to last line of previous item
      const prevItemIndex = selectedItemIndex - 1;
      const prevItemHeight = itemHeights.get(prevItemIndex) || 1;
      navigateToItem(prevItemIndex, prevItemHeight - 1);
    }
  }, [selectedItemIndex, selectedLineInItem, itemHeights, navigateToItem]);

  const navigateToNextLine = useCallback(() => {
    const currentItemHeight = itemHeights.get(selectedItemIndex) || 1;

    if (selectedLineInItem < currentItemHeight - 1) {
      // Move down within current item
      setSelectedLineInItem((prev) => prev + 1);
    } else if (selectedItemIndex < timeline.items.length - 1) {
      // Move to first line of next item
      navigateToItem(selectedItemIndex + 1, 0);
    }
  }, [selectedItemIndex, selectedLineInItem, itemHeights, timeline.items.length, navigateToItem]);

  // Item navigation
  const navigateToPreviousItem = useCallback(() => {
    if (selectedItemIndex > 0) {
      navigateToItem(selectedItemIndex - 1, 0);
    }
  }, [selectedItemIndex, navigateToItem]);

  const navigateToNextItem = useCallback(() => {
    if (selectedItemIndex < timeline.items.length - 1) {
      navigateToItem(selectedItemIndex + 1, 0);
    }
  }, [selectedItemIndex, timeline.items.length, navigateToItem]);

  // Page navigation
  const navigatePageUp = useCallback(() => {
    const newIndex = Math.max(0, selectedItemIndex - viewportHeight);
    navigateToItem(newIndex);
  }, [selectedItemIndex, viewportHeight, navigateToItem]);

  const navigatePageDown = useCallback(() => {
    const newIndex = Math.min(timeline.items.length - 1, selectedItemIndex + viewportHeight);
    navigateToItem(newIndex);
  }, [selectedItemIndex, viewportHeight, timeline.items.length, navigateToItem]);

  // Jump navigation
  const jumpToStart = useCallback(() => {
    navigateToItem(0);
  }, [navigateToItem]);

  const jumpToEnd = useCallback(() => {
    if (timeline.items.length > 0) {
      navigateToItem(timeline.items.length - 1);
    }
  }, [timeline.items.length, navigateToItem]);

  const jumpToItem = useCallback(
    (index: number) => {
      navigateToItem(index);
    },
    [navigateToItem]
  );

  // Get items in current window
  const getWindowItems = useCallback((): TimelineItem[] => {
    const endIndex = Math.min(windowStartIndex + windowSize, timeline.items.length);
    return timeline.items.slice(windowStartIndex, endIndex);
  }, [timeline.items, windowStartIndex, windowSize]);

  // Calculate cursor position within viewport
  const getCursorViewportLine = useCallback((): number => {
    let line = 0;

    // Sum heights of all items before selected item in the window
    for (let i = windowStartIndex; i < selectedItemIndex; i++) {
      if (i < windowStartIndex + windowSize) {
        line += itemHeights.get(i) || 1;
      }
    }

    // Add selected line within item
    line += selectedLineInItem;

    return line;
  }, [windowStartIndex, selectedItemIndex, selectedLineInItem, itemHeights, windowSize]);

  // Track if we should auto-scroll to bottom when timeline changes
  const prevTimelineLengthRef = useRef(timeline.items.length);

  useEffect(() => {
    const currentLength = timeline.items.length;
    const prevLength = prevTimelineLengthRef.current;

    if (currentLength !== prevLength) {
      // Handle initial load case: if we went from empty to having items (resume scenario)
      if (prevLength === 0 && currentLength > 0) {
        // Jump to bottom
        const lastIndex = currentLength - 1;
        setSelectedItemIndex(lastIndex);
        setSelectedLineInItem(0);
        setWindowStartIndex(Math.max(0, currentLength - windowSize));
      }
      // If timeline grew and we were at the end, stay at the end
      else if (currentLength > prevLength && selectedItemIndex === prevLength - 1) {
        // Follow to new bottom
        const lastIndex = currentLength - 1;
        setSelectedItemIndex(lastIndex);
        setSelectedLineInItem(0);
        setWindowStartIndex(Math.max(0, currentLength - windowSize));
      }

      prevTimelineLengthRef.current = currentLength;
    }
  }, [timeline.items.length, selectedItemIndex, windowSize]);

  return {
    // State
    selectedItemIndex,
    selectedLineInItem,
    windowStartIndex,
    windowSize,
    itemHeights,

    // Navigation
    navigateToPreviousLine,
    navigateToNextLine,
    navigateToPreviousItem,
    navigateToNextItem,
    navigatePageUp,
    navigatePageDown,
    jumpToStart,
    jumpToEnd,
    jumpToItem,

    // Height management
    setItemHeights,

    // Utilities
    getWindowItems,
    getCursorViewportLine,
  };
}
