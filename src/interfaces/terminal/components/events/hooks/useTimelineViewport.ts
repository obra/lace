// ABOUTME: Custom hook for timeline viewport state management including scrolling and focus
// ABOUTME: Encapsulates measurement, keyboard navigation, and auto-scroll behavior

import React, { useState, useCallback, useEffect } from 'react';
import { measureElement } from 'ink';
import { Timeline } from '../../../../thread-processor.js';
import { logger } from '../../../../../utils/logger.js';

export interface ViewportState {
  focusedLine: number;
  lineScrollOffset: number;
  itemPositions: number[];
  totalContentHeight: number;
  focusedItemIndex: number;
}

export interface ViewportActions {
  setFocusedLine: (line: number) => void;
  setLineScrollOffset: (offset: number) => void;
  getFocusedItemIndex: () => number;
  triggerRemeasurement: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  navigatePageUp: () => void;
  navigatePageDown: () => void;
  navigateToTop: () => void;
  navigateToBottom: () => void;
}

export interface UseTimelineViewportOptions {
  timeline: Timeline;
  viewportLines: number;
  itemRefs: React.MutableRefObject<Map<number, unknown>>;
}

export function useTimelineViewport({
  timeline,
  viewportLines,
  itemRefs,
}: UseTimelineViewportOptions): ViewportState & ViewportActions {
  const [focusedLine, setFocusedLine] = useState<number>(0);
  const [lineScrollOffset, setLineScrollOffset] = useState<number>(0);
  const [itemPositions, setItemPositions] = useState<number[]>([]);
  const [totalContentHeight, setTotalContentHeight] = useState<number>(0);
  const [measurementTrigger, setMeasurementTrigger] = useState<number>(0);
  const [itemToRefocusAfterMeasurement, setItemToRefocusAfterMeasurement] = useState<number>(-1);
  const [lastTimelineItemCount, setLastTimelineItemCount] = useState<number>(0);

  // Calculate which item contains the focused line
  const getFocusedItemIndex = useCallback(() => {
    if (itemPositions.length === 0) return -1;

    for (let i = 0; i < itemPositions.length; i++) {
      const itemStart = itemPositions[i];
      const itemEnd = i + 1 < itemPositions.length ? itemPositions[i + 1] : totalContentHeight;

      if (focusedLine >= itemStart && focusedLine < itemEnd) {
        return i;
      }
    }

    return -1;
  }, [focusedLine, itemPositions, totalContentHeight]);

  // Measure actual individual item heights after render
  useEffect(() => {
    const positions: number[] = [];
    let currentPosition = 0;

    for (let i = 0; i < timeline.items.length; i++) {
      positions[i] = currentPosition;

      const itemRef = itemRefs.current.get(i);
      if (itemRef) {
        const { height } = measureElement(itemRef);
        currentPosition += height;
      } else {
        // Only use fallback until ref is available
        currentPosition += 3;
      }
    }

    setItemPositions(positions);
    setTotalContentHeight(currentPosition);
  }, [timeline.items, itemRefs, measurementTrigger]);

  // After re-measurement, refocus on the first line of the remembered item
  useEffect(() => {
    if (itemToRefocusAfterMeasurement >= 0 && itemPositions.length > 0) {
      const newItemStart = itemPositions[itemToRefocusAfterMeasurement];
      logger.debug('useTimelineViewport: CollapsibleBox toggle - after remeasurement', {
        itemToRefocusAfterMeasurement,
        newItemStart,
        itemPositions: itemPositions.slice(0, 5),
        willSetFocusedLine: newItemStart,
      });
      if (newItemStart !== undefined) {
        setFocusedLine(newItemStart);
        // Reset flag after a delay
        setTimeout(() => {
          setItemToRefocusAfterMeasurement(-1);
        }, 50);
      }
    }
  }, [itemPositions, itemToRefocusAfterMeasurement]);

  // Auto-scroll viewport when focused line would go off-screen
  useEffect(() => {
    const topVisible = lineScrollOffset;
    const bottomVisible = lineScrollOffset + viewportLines - 1;

    if (focusedLine < topVisible) {
      // Focused line is above viewport, scroll up to show it
      setLineScrollOffset(focusedLine);
    } else if (focusedLine > bottomVisible) {
      // Focused line is below viewport, scroll down to show it
      setLineScrollOffset(focusedLine - viewportLines + 1);
    }
  }, [focusedLine, viewportLines]);

  // Track timeline item count changes to distinguish new content vs. height changes
  useEffect(() => {
    setLastTimelineItemCount(timeline.items.length);
  }, [timeline.items.length]);

  // Initialize to bottom when NEW CONTENT is added (but not during refocus after toggle)
  useEffect(() => {
    const hasNewContent = timeline.items.length > lastTimelineItemCount;

    if (totalContentHeight > 0 && itemToRefocusAfterMeasurement === -1 && hasNewContent) {
      // Only scroll to bottom for NEW timeline items, not height changes due to expansion
      const bottomLine = Math.max(0, totalContentHeight - 1);
      setFocusedLine(bottomLine);

      // Scroll to show the bottom
      const maxScroll = Math.max(0, totalContentHeight - viewportLines);
      setLineScrollOffset(maxScroll);
    }
  }, [
    totalContentHeight,
    viewportLines,
    itemToRefocusAfterMeasurement,
    timeline.items.length,
    lastTimelineItemCount,
  ]);

  // Navigation functions - pure, testable logic
  const navigateUp = useCallback(() => {
    setFocusedLine((prev) => Math.max(0, prev - 1));
  }, []);

  const navigateDown = useCallback(() => {
    setFocusedLine((prev) => {
      if (totalContentHeight > 0) {
        return Math.min(totalContentHeight - 1, prev + 1);
      }
      return prev + 1; // Allow unlimited movement when no content measured
    });
  }, [totalContentHeight]);

  const navigatePageUp = useCallback(() => {
    setFocusedLine((prev) => Math.max(0, prev - viewportLines));
  }, [viewportLines]);

  const navigatePageDown = useCallback(() => {
    setFocusedLine((prev) => {
      if (totalContentHeight > 0) {
        return Math.min(totalContentHeight - 1, prev + viewportLines);
      }
      return prev + viewportLines; // Allow unlimited movement when no content measured
    });
  }, [totalContentHeight, viewportLines]);

  const navigateToTop = useCallback(() => {
    setFocusedLine(0);
  }, []);

  const navigateToBottom = useCallback(() => {
    setFocusedLine((prev) => (totalContentHeight > 0 ? Math.max(0, totalContentHeight - 1) : prev));
  }, [totalContentHeight]);

  const triggerRemeasurement = useCallback(() => {
    // Remember which item is currently focused before re-measurement
    const currentFocusedItemIndex = getFocusedItemIndex();
    logger.debug('useTimelineViewport: CollapsibleBox toggle - before remeasurement', {
      currentFocusedItemIndex,
      focusedLine,
      totalContentHeight,
      itemPositions: itemPositions.slice(0, 5), // First 5 to avoid spam
    });
    setItemToRefocusAfterMeasurement(currentFocusedItemIndex);
    setMeasurementTrigger((prev) => prev + 1);
  }, [getFocusedItemIndex, focusedLine, totalContentHeight, itemPositions]);

  return {
    // State
    focusedLine,
    lineScrollOffset,
    itemPositions,
    totalContentHeight,
    focusedItemIndex: getFocusedItemIndex(),

    // Actions
    setFocusedLine,
    setLineScrollOffset,
    getFocusedItemIndex,
    triggerRemeasurement,
    navigateUp,
    navigateDown,
    navigatePageUp,
    navigatePageDown,
    navigateToTop,
    navigateToBottom,
  };
}
