// ABOUTME: Viewport container component for timeline display with scrolling and navigation
// ABOUTME: Manages viewport state and keyboard input, renders content and scroll indicators

import React, { useRef } from 'react';
import { Box, useInput, Text, DOMElement } from 'ink';
import useStdoutDimensions from '~/utils/use-stdout-dimensions.js';
import { Timeline } from '~/interfaces/timeline-types.js';
import { useTimelineViewport } from '~/interfaces/terminal/components/events/hooks/useTimelineViewport.js';
import { logger } from '~/utils/logger.js';
import {
  FocusRegions,
  useLaceFocus,
  useLaceFocusContext,
} from '~/interfaces/terminal/focus/index.js';
import { RenderDebugPanel } from '~/interfaces/terminal/components/debug/RenderDebugPanel.js';

interface TimelineViewportProps {
  timeline: Timeline;
  bottomSectionHeight?: number;
  focusRegion?: string; // Optional focus region ID, defaults to FocusRegions.timeline
  onItemInteraction?: (
    selectedItemIndex: number,
    input: string,
    key: {
      leftArrow?: boolean;
      rightArrow?: boolean;
      return?: boolean;
      [key: string]: boolean | undefined;
    },
    itemRefs?: React.MutableRefObject<Map<number, unknown>>
  ) => void;
  isTimelineLayoutDebugVisible?: boolean;
  children: (props: {
    timeline: Timeline;
    viewportState: {
      selectedLine: number;
      lineScrollOffset: number;
      itemPositions: number[];
      totalContentHeight: number;
      selectedItemIndex: number;
      measurementTrigger: number;
    };
    viewportActions: {
      triggerRemeasurement: () => void;
    };
    itemRefs: React.MutableRefObject<Map<number, unknown>>;
    viewportLines: number;
  }) => React.ReactNode;
}

export function TimelineViewport({
  timeline,
  bottomSectionHeight,
  focusRegion,
  onItemInteraction,
  isTimelineLayoutDebugVisible,
  children,
}: TimelineViewportProps) {
  // Use Lace focus system with custom focus region or default
  const { isFocused } = useLaceFocus(focusRegion || FocusRegions.timeline, {
    autoFocus: false,
  });
  const [, terminalHeight] = useStdoutDimensions();

  // Item refs for measurement
  const itemRefs = useRef<Map<number, unknown>>(new Map());

  // Calculate viewport height
  const viewportLines = bottomSectionHeight
    ? Math.max(10, (terminalHeight || 30) - bottomSectionHeight)
    : 10;

  // Use the viewport hook
  const viewport = useTimelineViewport({
    timeline,
    viewportLines,
    itemRefs,
    isFocused,
  });

  // Measure scroll indicator heights
  const topIndicatorRef = useRef<DOMElement | null>(null);
  const bottomIndicatorRef = useRef<DOMElement | null>(null);

  // Calculate scroll indicator visibility
  const hasMoreAbove = viewport.lineScrollOffset > 0;
  const hasMoreBelow =
    viewport.totalContentHeight > 0 &&
    viewport.lineScrollOffset + viewportLines < viewport.totalContentHeight;

  // Get focus context to check for delegate focus
  const { currentFocus } = useLaceFocusContext();

  // Handle keyboard navigation
  useInput(
    (input, key) => {
      logger.debug('TimelineViewport: Key pressed', {
        key,
        input,
        isFocused,
        currentFocus,
        focusRegion: focusRegion || FocusRegions.timeline,
        isActive: isFocused && viewport.totalContentHeight > 0,
      });

      // Don't handle keys if focus is in a delegate context and this is the main timeline
      const isMainTimeline = (focusRegion || FocusRegions.timeline) === FocusRegions.timeline;
      const isInDelegateContext = currentFocus.startsWith('delegate-');

      logger.debug('TimelineViewport: Key handling decision', {
        currentFocus,
        focusRegion: focusRegion || FocusRegions.timeline,
        isMainTimeline,
        isInDelegateContext,
        willIgnore: isMainTimeline && isInDelegateContext,
      });

      if (isMainTimeline && isInDelegateContext) {
        logger.debug('TimelineViewport: Ignoring key in main timeline while in delegate context');
        return; // Let delegate timeline handle all keys
      }

      // No escape handling - provider handles global escape to pop focus stack

      if (key.upArrow) {
        viewport.navigateUp();
      } else if (key.downArrow) {
        viewport.navigateDown();
      } else if (key.pageUp) {
        viewport.navigatePageUp();
      } else if (key.pageDown) {
        viewport.navigatePageDown();
      } else if (input === 'g') {
        viewport.navigateToTop();
      } else if (input === 'G') {
        viewport.navigateToBottom();
      } else if (key.leftArrow || key.rightArrow || key.return) {
        // Forward item interactions to parent with itemRefs
        logger.debug('TimelineViewport: Forwarding item interaction', {
          currentFocus,
          focusRegion: focusRegion || FocusRegions.timeline,
          selectedItemIndex: viewport.selectedItemIndex,
          key: Object.keys(key)
            .filter((k) => (key as Record<string, unknown>)[k])
            .join('+'),
          hasCallback: !!onItemInteraction,
        });
        if (onItemInteraction) {
          onItemInteraction(viewport.selectedItemIndex, input, key, itemRefs);
        }
      }
    },
    { isActive: isFocused }
  ); // Always active when focused, not just when content exists

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Scroll indicator - more content above */}
      {hasMoreAbove && (
        <Box justifyContent="center" ref={topIndicatorRef}>
          <Text color="dim">↑ content above (line {viewport.lineScrollOffset}) ↑</Text>
        </Box>
      )}

      {/* Viewport container with cursor overlay */}
      <Box height={viewportLines} flexDirection="column" overflow="hidden">
        {/* Content container */}
        <Box flexDirection="column" marginTop={-viewport.lineScrollOffset} flexShrink={0}>
          {children({
            timeline,
            viewportState: {
              selectedLine: viewport.selectedLine,
              lineScrollOffset: viewport.lineScrollOffset,
              itemPositions: viewport.itemPositions,
              totalContentHeight: viewport.totalContentHeight,
              selectedItemIndex: viewport.selectedItemIndex,
              measurementTrigger: viewport.measurementTrigger,
            },
            viewportActions: {
              triggerRemeasurement: viewport.triggerRemeasurement,
            },
            itemRefs,
            viewportLines,
          })}
        </Box>

        {/* Cursor overlay */}
        {isFocused && (
          <Box
            position="absolute"
            flexDirection="column"
            marginTop={-viewport.lineScrollOffset + viewport.selectedLine}
          >
            <Text backgroundColor="white" color="black">
              {'>'}
            </Text>
          </Box>
        )}
      </Box>

      {/* Scroll indicator - more content below */}
      {hasMoreBelow && (
        <Box justifyContent="center" ref={bottomIndicatorRef}>
          <Text color="dim">↓ content below ↓</Text>
        </Box>
      )}

      {/* Debug panel */}
      <RenderDebugPanel
        isVisible={!!isTimelineLayoutDebugVisible}
        timeline={timeline}
        viewportState={{
          selectedLine: viewport.selectedLine,
          lineScrollOffset: viewport.lineScrollOffset,
          itemPositions: viewport.itemPositions,
          totalContentHeight: viewport.totalContentHeight,
          selectedItemIndex: viewport.selectedItemIndex,
          measurementTrigger: viewport.measurementTrigger,
        }}
        onClose={() => {}}
      />
    </Box>
  );
}
