// ABOUTME: Line-based scrolling state management for timeline virtualization
// ABOUTME: Implements smooth line-by-line scrolling with overflow hidden

import { useState, useCallback, useRef, useEffect } from 'react';
import { Timeline, TimelineItem } from '~/interfaces/timeline-types.js';
import { logger } from '~/utils/logger.js';

export interface UseTimelineWindowOptions {
  timeline: Timeline;
  viewportHeight: number; // Terminal lines available
  windowSize?: number; // Items to render (default: 100 for better scrolling)
}

export interface TimelineWindowState {
  // Selection state
  selectedItemIndex: number;
  selectedLineInItem: number;

  // Scroll state
  scrollTop: number;
  innerHeight: number; // Total height of all rendered items

  // Measurements (only for rendered items)
  itemHeights: Map<number, number>;
  itemPositions: Map<number, number>; // Cumulative line position of each item

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
  getWindowStartIndex: () => number; // First item index in window
  getCursorViewportLine: () => number;
  getCursorAbsoluteLine: () => number;
  
  // Spacer heights for virtualization
  topSpacerHeight: number;
}

export function useTimelineWindow({
  timeline,
  viewportHeight,
}: UseTimelineWindowOptions): TimelineWindowState {
  // Debug: Log renders
  logger.debug('[useTimelineWindow] Rendering', {
    timelineLength: timeline.items.length,
    viewportHeight,
  });
  // Track if we've initialized to prevent re-initialization on timeline object changes
  const hasInitializedRef = useRef(false);

  // Calculate initial values
  const getInitialValues = () => {
    const itemIndex = timeline.items.length > 0 ? timeline.items.length - 1 : -1;
    return { itemIndex };
  };

  // Use lazy initialization to prevent re-initialization
  const [selectedItemIndex, setSelectedItemIndex] = useState(() => {
    const { itemIndex } = getInitialValues();
    hasInitializedRef.current = true;
    return itemIndex;
  });

  const [selectedLineInItem, setSelectedLineInItem] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [innerHeight, setInnerHeight] = useState(0);

  // Item measurements
  const [itemHeights, setItemHeights] = useState<Map<number, number>>(new Map());
  const [itemPositions, setItemPositions] = useState<Map<number, number>>(new Map());
  
  // Track window bounds and spacer heights
  const [windowBounds, setWindowBounds] = useState({ start: 0, end: 50 });
  const [topSpacerHeight, setTopSpacerHeight] = useState(0);

  // Calculate item positions whenever heights change
  useEffect(() => {
    const positions = new Map<number, number>();
    let cumulativeHeight = topSpacerHeight; // Start with spacer

    // Only calculate positions for items in or near the window
    const calcStart = Math.max(0, windowBounds.start - 10);
    const calcEnd = Math.min(timeline.items.length, windowBounds.end + 10);
    
    // For items before the calculation range, use the spacer height
    for (let i = 0; i < calcStart; i++) {
      positions.set(i, topSpacerHeight); // Approximate - items are in the spacer
    }
    
    // Calculate actual positions for items near the window
    for (let i = calcStart; i < calcEnd; i++) {
      positions.set(i, cumulativeHeight);
      cumulativeHeight += itemHeights.get(i) || 1;
    }
    
    // For items after the window, approximate
    for (let i = calcEnd; i < timeline.items.length; i++) {
      positions.set(i, cumulativeHeight);
      cumulativeHeight += 1; // Default height
    }

    setItemPositions(positions);
    setInnerHeight(cumulativeHeight);
  }, [itemHeights, timeline.items.length, topSpacerHeight, windowBounds]);

  // Calculate absolute line position of cursor
  const getCursorAbsoluteLine = useCallback((): number => {
    const itemPosition = itemPositions.get(selectedItemIndex) || 0;
    return itemPosition + selectedLineInItem;
  }, [selectedItemIndex, selectedLineInItem, itemPositions]);

  // Calculate cursor position within viewport (accounting for scroll)
  const getCursorViewportLine = useCallback((): number => {
    const absoluteLine = getCursorAbsoluteLine();
    return absoluteLine - scrollTop;
  }, [getCursorAbsoluteLine, scrollTop]);

  // Update scroll position to keep cursor visible
  const updateScrollForCursor = useCallback(() => {
    const cursorAbsoluteLine = getCursorAbsoluteLine();
    const cursorViewportLine = cursorAbsoluteLine - scrollTop;

    let newScrollTop = scrollTop;

    // Scroll up if cursor above viewport
    if (cursorViewportLine < 0) {
      newScrollTop = cursorAbsoluteLine;
    }
    // Scroll down if cursor below viewport
    else if (cursorViewportLine >= viewportHeight) {
      newScrollTop = cursorAbsoluteLine - viewportHeight + 1;
    }

    // Clamp to valid range
    const maxScroll = Math.max(0, innerHeight - viewportHeight);
    newScrollTop = Math.max(0, Math.min(maxScroll, newScrollTop));

    if (newScrollTop !== scrollTop) {
      logger.debug('[useTimelineWindow] Scrolling:', {
        oldScrollTop: scrollTop,
        newScrollTop,
        cursorAbsoluteLine,
        cursorViewportLine,
        viewportHeight,
        reason: cursorViewportLine < 0 ? 'cursor-above' : 'cursor-below',
      });
      setScrollTop(newScrollTop);
    }
  }, [getCursorAbsoluteLine, scrollTop, viewportHeight, innerHeight]);

  // Navigate to a specific item
  const navigateToItem = useCallback(
    (index: number, lineInItem = 0) => {
      if (timeline.items.length === 0) return;

      const clampedIndex = Math.max(0, Math.min(timeline.items.length - 1, index));

      logger.debug('[useTimelineWindow] navigateToItem:', {
        requestedIndex: index,
        clampedIndex,
        lineInItem,
        currentSelectedItemIndex: selectedItemIndex,
      });

      setSelectedItemIndex(clampedIndex);
      setSelectedLineInItem(lineInItem);

      // Update scroll will be called in effect
    },
    [timeline.items.length, selectedItemIndex]
  );

  // Update scroll whenever selection changes
  useEffect(() => {
    updateScrollForCursor();
  }, [updateScrollForCursor]);

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
    // Scroll up by viewport height
    const newScrollTop = Math.max(0, scrollTop - viewportHeight);
    setScrollTop(newScrollTop);

    // Find item at new scroll position
    let targetIndex = 0;
    for (let i = 0; i < timeline.items.length; i++) {
      const itemPos = itemPositions.get(i) || 0;
      if (itemPos >= newScrollTop) {
        targetIndex = i;
        break;
      }
    }
    navigateToItem(targetIndex, 0);
  }, [scrollTop, viewportHeight, timeline.items.length, itemPositions, navigateToItem]);

  const navigatePageDown = useCallback(() => {
    // Scroll down by viewport height
    const maxScroll = Math.max(0, innerHeight - viewportHeight);
    const newScrollTop = Math.min(maxScroll, scrollTop + viewportHeight);
    setScrollTop(newScrollTop);

    // Find item at new scroll position
    let targetIndex = timeline.items.length - 1;
    for (let i = 0; i < timeline.items.length; i++) {
      const itemPos = itemPositions.get(i) || 0;
      if (itemPos >= newScrollTop + viewportHeight - 1) {
        targetIndex = Math.max(0, i - 1);
        break;
      }
    }
    navigateToItem(targetIndex, 0);
  }, [
    scrollTop,
    viewportHeight,
    innerHeight,
    timeline.items.length,
    itemPositions,
    navigateToItem,
  ]);

  // Jump navigation
  const jumpToStart = useCallback(() => {
    setScrollTop(0);
    navigateToItem(0, 0);
  }, [navigateToItem]);

  const jumpToEnd = useCallback(() => {
    if (timeline.items.length > 0) {
      const lastIndex = timeline.items.length - 1;
      navigateToItem(lastIndex, 0);

      // Scroll to bottom
      const maxScroll = Math.max(0, innerHeight - viewportHeight);
      setScrollTop(maxScroll);
    }
  }, [timeline.items.length, navigateToItem, innerHeight, viewportHeight]);

  const jumpToItem = useCallback(
    (index: number) => {
      navigateToItem(index);
    },
    [navigateToItem]
  );

  // Calculate window bounds with sliding behavior
  useEffect(() => {
    if (timeline.items.length === 0) {
      setWindowBounds((prev) => {
        if (prev.start === 0 && prev.end === 0) {
          return prev; // Already empty
        }
        return { start: 0, end: 0 };
      });
      setTopSpacerHeight(0);
      return;
    }

    const WINDOW_SIZE = 50; // Total items to render
    const EXTEND_THRESHOLD = 10; // Extend when cursor is within this many items of edge
    
    setWindowBounds((prev) => {
      let newStart = prev.start;
      let newEnd = prev.end;
      
      // Initial window
      if (prev.end === 0 || prev.end > timeline.items.length) {
        // Start at the end for initial load
        newEnd = timeline.items.length;
        newStart = Math.max(0, newEnd - WINDOW_SIZE);
        setTopSpacerHeight(0);
        return { start: newStart, end: newEnd };
      }
      
      // Check if we need to extend the window
      const distanceFromStart = selectedItemIndex - prev.start;
      const distanceFromEnd = prev.end - 1 - selectedItemIndex;
      
      // Extend downward
      if (distanceFromEnd < EXTEND_THRESHOLD && prev.end < timeline.items.length) {
        const extendBy = Math.min(10, timeline.items.length - prev.end);
        newEnd = prev.end + extendBy;
        
        // Trim from top if window is too large
        if (newEnd - newStart > WINDOW_SIZE) {
          const trimCount = newEnd - newStart - WINDOW_SIZE;
          // Calculate height of items we're trimming
          let trimmedHeight = 0;
          for (let i = newStart; i < newStart + trimCount; i++) {
            trimmedHeight += itemHeights.get(i) || 1;
          }
          setTopSpacerHeight(prev => prev + trimmedHeight);
          newStart += trimCount;
        }
      }
      
      // Extend upward
      if (distanceFromStart < EXTEND_THRESHOLD && prev.start > 0) {
        const extendBy = Math.min(10, prev.start);
        newStart = prev.start - extendBy;
        
        // Reduce top spacer since we're showing real items
        let restoredHeight = 0;
        for (let i = newStart; i < prev.start; i++) {
          restoredHeight += itemHeights.get(i) || 1;
        }
        setTopSpacerHeight(prev => Math.max(0, prev - restoredHeight));
        
        // Trim from bottom if window is too large
        if (newEnd - newStart > WINDOW_SIZE) {
          const trimCount = newEnd - newStart - WINDOW_SIZE;
          // We don't track bottom spacer height since it's implicit
          newEnd -= trimCount;
        }
      }
      
      if (newStart === prev.start && newEnd === prev.end) {
        return prev; // No change
      }
      
      logger.debug('[useTimelineWindow] Window sliding:', {
        selectedItemIndex,
        oldWindow: `${prev.start}-${prev.end}`,
        newWindow: `${newStart}-${newEnd}`,
        topSpacerHeight,
      });
      
      return { start: newStart, end: newEnd };
    });
  }, [selectedItemIndex, timeline.items.length, itemHeights]);

  // Get items that should be rendered (only visible items plus buffer)
  const getWindowItems = useCallback((): TimelineItem[] => {
    return timeline.items.slice(windowBounds.start, windowBounds.end);
  }, [timeline.items, windowBounds]);

  // Get the starting index of the window
  const getWindowStartIndex = useCallback((): number => {
    return windowBounds.start;
  }, [windowBounds]);

  // Track if we should auto-scroll to bottom when timeline changes
  const prevTimelineLengthRef = useRef(timeline.items.length);
  const hasJumpedToBottomRef = useRef(false);

  useEffect(() => {
    const currentLength = timeline.items.length;
    const prevLength = prevTimelineLengthRef.current;

    if (currentLength !== prevLength) {
      logger.debug('[useTimelineWindow] Timeline length changed:', {
        prevLength,
        currentLength,
        selectedItemIndex,
      });

      // Handle initial load case: if we went from empty to having items
      if (prevLength === 0 && currentLength > 0 && !hasJumpedToBottomRef.current) {
        logger.debug('[useTimelineWindow] Jumping to bottom on initial load');
        hasJumpedToBottomRef.current = true;
        jumpToEnd();
      }
      // If timeline grew and we were at the end, stay at the end
      else if (currentLength > prevLength && selectedItemIndex === prevLength - 1) {
        logger.debug('[useTimelineWindow] Following to new bottom');
        jumpToEnd();
      }

      prevTimelineLengthRef.current = currentLength;
    }
  }, [timeline.items.length, selectedItemIndex, jumpToEnd]);

  return {
    // State
    selectedItemIndex,
    selectedLineInItem,
    scrollTop,
    innerHeight,
    itemHeights,
    itemPositions,

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
    getWindowStartIndex,
    getCursorViewportLine,
    getCursorAbsoluteLine,
    
    // Spacer
    topSpacerHeight,
  };
}
