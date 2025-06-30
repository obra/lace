// ABOUTME: Custom hook for timeline viewport state management including scrolling and selection
// ABOUTME: Encapsulates measurement, keyboard navigation, and auto-scroll behavior

import React, { useState, useCallback, useEffect } from 'react';
import { measureElement, DOMElement } from 'ink';
import { Timeline } from '../../../../thread-processor.js';

export interface ViewportState {
  selectedLine: number;
  lineScrollOffset: number;
  itemPositions: number[];
  totalContentHeight: number;
  selectedItemIndex: number;
  measurementTrigger: number;
}

export interface ViewportActions {
  setSelectedLine: (line: number) => void;
  setLineScrollOffset: (offset: number) => void;
  getSelectedItemIndex: () => number;
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
  const [selectedLine, setSelectedLine] = useState<number>(0);
  const [lineScrollOffset, setLineScrollOffset] = useState<number>(0);
  const [itemPositions, setItemPositions] = useState<number[]>([]);
  const [totalContentHeight, setTotalContentHeight] = useState<number>(0);
  const [measurementTrigger, setMeasurementTrigger] = useState<number>(0);
  const [itemToReselectAfterMeasurement, setItemToReselectAfterMeasurement] = useState<number>(-1);
  const [lastTimelineItemCount, setLastTimelineItemCount] = useState<number>(0);

  // Calculate which item contains the selected line
  const getSelectedItemIndex = useCallback(() => {
    if (itemPositions.length === 0) return -1;

    for (let i = 0; i < itemPositions.length; i++) {
      const itemStart = itemPositions[i];
      const itemEnd = i + 1 < itemPositions.length ? itemPositions[i + 1] : totalContentHeight;

      if (selectedLine >= itemStart && selectedLine < itemEnd) {
        return i;
      }
    }

    return -1;
  }, [selectedLine, itemPositions, totalContentHeight]);

  // Measure actual individual item heights after render
  useEffect(() => {
    // Defer measurement to ensure DOM has updated after expansion/collapse
    const measureAfterDOMUpdate = () => {
      const positions: number[] = [];
      let currentPosition = 0;
      const measuredHeights: number[] = [];

      for (let i = 0; i < timeline.items.length; i++) {
        positions[i] = currentPosition;

        const itemRef = itemRefs.current.get(i);
        if (itemRef && typeof itemRef === 'object' && 'nodeName' in itemRef) {
          const { height } = measureElement(itemRef as DOMElement);
          measuredHeights[i] = height;
          currentPosition += height;
        } else {
          // Only use fallback until ref is available
          measuredHeights[i] = 3;
          currentPosition += 3;
        }
      }

      setItemPositions(positions);
      setTotalContentHeight(currentPosition);
    };

    measureAfterDOMUpdate();
  }, [timeline.items, itemRefs, measurementTrigger]);

  // After re-measurement, reselect the first line of the remembered item
  useEffect(() => {
    if (itemToReselectAfterMeasurement >= 0 && itemPositions.length > 0) {
      const newItemStart = itemPositions[itemToReselectAfterMeasurement];
      if (newItemStart !== undefined) {
        setSelectedLine(newItemStart);
        setItemToReselectAfterMeasurement(-1);
      }
    }
  }, [itemPositions, itemToReselectAfterMeasurement]);

  // Auto-scroll viewport when selected line would go off-screen
  useEffect(() => {
    const topVisible = lineScrollOffset;
    const bottomVisible = lineScrollOffset + viewportLines - 1;

    if (selectedLine < topVisible) {
      // Selected line is above viewport, scroll up to show it
      setLineScrollOffset(selectedLine);
    } else if (selectedLine > bottomVisible) {
      // Selected line is below viewport, scroll down to show it
      setLineScrollOffset(selectedLine - viewportLines + 1);
    }
  }, [selectedLine, viewportLines]);

  // Track timeline item count changes to distinguish new content vs. height changes
  useEffect(() => {
    setLastTimelineItemCount(timeline.items.length);
  }, [timeline.items.length]);

  // Initialize to bottom when NEW CONTENT is added (but not during refocus after toggle)
  useEffect(() => {
    const hasNewContent = timeline.items.length > lastTimelineItemCount;

    if (totalContentHeight > 0 && itemToReselectAfterMeasurement === -1 && hasNewContent) {
      // Only scroll to bottom for NEW timeline items, not height changes due to expansion
      const bottomLine = Math.max(0, totalContentHeight - 1);
      setSelectedLine(bottomLine);

      // Scroll to show the bottom
      const maxScroll = Math.max(0, totalContentHeight - viewportLines);
      setLineScrollOffset(maxScroll);
    }
  }, [
    totalContentHeight,
    viewportLines,
    itemToReselectAfterMeasurement,
    timeline.items.length,
    lastTimelineItemCount,
  ]);

  // Navigation functions - pure, testable logic
  const navigateUp = useCallback(() => {
    setSelectedLine((prev) => Math.max(0, prev - 1));
  }, []);

  const navigateDown = useCallback(() => {
    setSelectedLine((prev) => {
      if (totalContentHeight > 0) {
        return Math.min(totalContentHeight - 1, prev + 1);
      }
      return prev + 1; // Allow unlimited movement when no content measured
    });
  }, [totalContentHeight]);

  const navigatePageUp = useCallback(() => {
    setSelectedLine((prev) => Math.max(0, prev - viewportLines));
  }, [viewportLines]);

  const navigatePageDown = useCallback(() => {
    setSelectedLine((prev) => {
      if (totalContentHeight > 0) {
        return Math.min(totalContentHeight - 1, prev + viewportLines);
      }
      return prev + viewportLines; // Allow unlimited movement when no content measured
    });
  }, [totalContentHeight, viewportLines]);

  const navigateToTop = useCallback(() => {
    setSelectedLine(0);
  }, []);

  const navigateToBottom = useCallback(() => {
    setSelectedLine((prev) =>
      totalContentHeight > 0 ? Math.max(0, totalContentHeight - 1) : prev
    );
  }, [totalContentHeight]);

  const triggerRemeasurement = useCallback(() => {
    // Remember which item is currently selected before re-measurement
    const currentSelectedItemIndex = getSelectedItemIndex();
    setItemToReselectAfterMeasurement(currentSelectedItemIndex);
    setMeasurementTrigger((prev) => prev + 1);
  }, [getSelectedItemIndex]);

  return {
    // State
    selectedLine,
    lineScrollOffset,
    itemPositions,
    totalContentHeight,
    selectedItemIndex: getSelectedItemIndex(),
    measurementTrigger,

    // Actions
    setSelectedLine,
    setLineScrollOffset,
    getSelectedItemIndex,
    triggerRemeasurement,
    navigateUp,
    navigateDown,
    navigatePageUp,
    navigatePageDown,
    navigateToTop,
    navigateToBottom,
  };
}
