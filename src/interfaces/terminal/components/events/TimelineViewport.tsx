// ABOUTME: Viewport container component for timeline display with scrolling and navigation
// ABOUTME: Manages viewport state and keyboard input, renders content and scroll indicators

import React, { useRef } from 'react';
import { Box, useInput, useFocus, useFocusManager, Text } from 'ink';
import useStdoutDimensions from '../../../../utils/use-stdout-dimensions.js';
import { Timeline } from '../../../thread-processor.js';
import { useTimelineViewport } from './hooks/useTimelineViewport.js';
import { logger } from '../../../../utils/logger.js';

interface TimelineViewportProps {
  timeline: Timeline;
  focusId?: string;
  parentFocusId?: string;
  bottomSectionHeight?: number;
  onItemInteraction?: (selectedItemIndex: number, input: string, key: any) => void;
  children: (props: {
    timeline: Timeline;
    viewportState: {
      selectedLine: number;
      lineScrollOffset: number;
      itemPositions: number[];
      totalContentHeight: number;
      selectedItemIndex: number;
    };
    viewportActions: {
      triggerRemeasurement: () => void;
    };
    itemRefs: React.MutableRefObject<Map<number, any>>;
  }) => React.ReactNode;
}

export function TimelineViewport({
  timeline,
  focusId,
  parentFocusId,
  bottomSectionHeight,
  onItemInteraction,
  children,
}: TimelineViewportProps) {
  const { isFocused } = useFocus({ id: focusId || 'timeline' });
  const { focusNext, focus } = useFocusManager();
  const [, terminalHeight] = useStdoutDimensions();

  // Item refs for measurement
  const itemRefs = useRef<Map<number, any>>(new Map());

  // Calculate viewport height
  const viewportLines = bottomSectionHeight
    ? Math.max(10, (terminalHeight || 30) - bottomSectionHeight)
    : 10;

  // Use the viewport hook
  const viewport = useTimelineViewport({
    timeline,
    viewportLines,
    itemRefs,
  });

  // Measure scroll indicator heights
  const topIndicatorRef = useRef<any>(null);
  const bottomIndicatorRef = useRef<any>(null);

  // Calculate scroll indicator visibility
  const hasMoreAbove = viewport.lineScrollOffset > 0;
  const hasMoreBelow =
    viewport.totalContentHeight > 0 &&
    viewport.lineScrollOffset + viewportLines < viewport.totalContentHeight;

  // Handle keyboard navigation
  useInput(
    (input, key) => {
      logger.debug('TimelineViewport: Key pressed', {
        key,
        input,
        isFocused,
        focusId,
        isActive: isFocused && viewport.totalContentHeight > 0,
      });

      if (key.escape) {
        // Handle escape based on focus hierarchy
        const currentFocusId = focusId || 'timeline';
        logger.debug('TimelineViewport: Escape key pressed', {
          currentFocusId,
          parentFocusId,
          action: parentFocusId ? `focus(${parentFocusId})` : 'focus(shell-input)',
        });

        if (parentFocusId) {
          focus(parentFocusId);
        } else {
          // Focus the shell input specifically
          focus('shell-input');
        }
        return;
      }

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
        // Forward item interactions to parent
        if (onItemInteraction) {
          onItemInteraction(viewport.selectedItemIndex, input, key);
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
            },
            viewportActions: {
              triggerRemeasurement: viewport.triggerRemeasurement,
            },
            itemRefs,
          })}
        </Box>

        {/* Cursor overlay */}
 	{ isFocused && 
        <Box
          position="absolute"
          flexDirection="column"
          marginTop={-viewport.lineScrollOffset + viewport.selectedLine}
        >
          <Text backgroundColor="white" color="black">
            {'>'}
          </Text>
        </Box>
	}
      </Box>

      {/* Scroll indicator - more content below */}
      {hasMoreBelow && (
        <Box justifyContent="center" ref={bottomIndicatorRef}>
          <Text color="dim">↓ content below ↓</Text>
        </Box>
      )}
    </Box>
  );
}
