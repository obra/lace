// ABOUTME: Viewport container component for timeline display with window-based scrolling
// ABOUTME: Manages window state, keyboard navigation, and cursor rendering with virtualization

import React, { useRef, useEffect, useState } from 'react';
import { Box, useInput, Text, useFocus, measureElement } from 'ink';
import useStdoutDimensions from '../../../../utils/use-stdout-dimensions.js';
import { Timeline } from '../../../timeline-types.js';
import { useTimelineWindow, TimelineWindowState } from './hooks/useTimelineWindow.js';
import { logger } from '../../../../utils/logger.js';
import { FocusRegions, useLaceFocus, useLaceFocusContext } from '../../focus/index.js';
import { RenderDebugPanel } from '../debug/RenderDebugPanel.js';

interface TimelineViewportProps {
  timeline: Timeline;
  bottomSectionHeight?: number;
  focusRegion?: string; // Optional focus region ID, defaults to FocusRegions.timeline
  onItemInteraction?: (selectedItemIndex: number, input: string, key: any, itemRefs?: React.MutableRefObject<Map<number, any>>) => void;
  isTimelineLayoutDebugVisible?: boolean;
  children: (props: {
    windowState: TimelineWindowState;
    viewportActions: {
      triggerRemeasurement: () => void;
    };
    itemRefs: React.MutableRefObject<Map<number, any>>;
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
  // Debug: log when component mounts/unmounts
  useEffect(() => {
    logger.debug('TimelineViewport mounted', { timelineLength: timeline.items.length });
    return () => {
      logger.debug('TimelineViewport unmounted');
    };
  }, []);

  // Use Lace focus system with custom focus region or default
  const { isFocused, takeFocus } = useLaceFocus(focusRegion || FocusRegions.timeline, { autoFocus: false });
  const [, terminalHeight] = useStdoutDimensions();

  // Item refs for measurement
  const itemRefs = useRef<Map<number, any>>(new Map());

  // Calculate viewport height
  const viewportLines = bottomSectionHeight
    ? Math.max(10, (terminalHeight || 30) - bottomSectionHeight)
    : 10;

  // Use the window-based viewport hook with line scrolling
  const windowState = useTimelineWindow({
    timeline,
    viewportHeight: viewportLines,
  });

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
        isActive: isFocused && timeline.items.length > 0,
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
        logger.debug('TimelineViewport: Up arrow pressed');
        windowState.navigateToPreviousLine();
      } else if (key.downArrow) {
        logger.debug('TimelineViewport: Down arrow pressed');
        windowState.navigateToNextLine();
      } else if (key.pageUp) {
        windowState.navigatePageUp();
      } else if (key.pageDown) {
        windowState.navigatePageDown();
      } else if (input === 'g') {
        windowState.jumpToStart();
      } else if (input === 'G') {
        windowState.jumpToEnd();
      } else if (key.leftArrow || key.rightArrow || key.return) {
        // Forward item interactions to parent with itemRefs
        logger.debug('TimelineViewport: Forwarding item interaction', {
          currentFocus,
          focusRegion: focusRegion || FocusRegions.timeline,
          selectedItemIndex: windowState.selectedItemIndex,
          key: Object.keys(key).filter(k => (key as any)[k]).join('+'),
          hasCallback: !!onItemInteraction,
        });
        if (onItemInteraction) {
          onItemInteraction(windowState.selectedItemIndex, input, key, itemRefs);
        }
      }
    },
    { isActive: isFocused }
  ); // Always active when focused, not just when content exists

  // Update item heights after measurement
  useEffect(() => {
    const heights = new Map<number, number>();
    
    for (const [index, ref] of itemRefs.current.entries()) {
      if (ref && typeof ref === 'object' && 'nodeName' in ref) {
        const { height } = measureElement(ref);
        heights.set(index, height);
      }
    }
    
    windowState.setItemHeights(heights);
  }, [windowState.scrollTop, timeline.items.length, windowState.setItemHeights]);

  // Trigger remeasurement function
  const triggerRemeasurement = () => {
    // Force re-render by updating a state variable
    // This will cause useEffect to run again and remeasure
    setMeasurementTrigger(prev => prev + 1);
  };

  const [measurementTrigger, setMeasurementTrigger] = useState(0);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Viewport container with cursor overlay */}
      <Box height={viewportLines} flexDirection="column" overflow="hidden">
        {/* Content container with negative margin for scrolling */}
        <Box 
          flexDirection="column" 
          flexShrink={0}
          marginTop={-windowState.scrollTop}
        >
          {children({
            windowState,
            viewportActions: {
              triggerRemeasurement,
            },
            itemRefs,
          })}
        </Box>

        {/* Cursor overlay */}
        {isFocused && (
          <Box
            position="absolute"
            flexDirection="column"
            marginTop={windowState.getCursorViewportLine()}
          >
            <Text backgroundColor="white" color="black">
              {'>'}
            </Text>
          </Box>
        )}
      </Box>

      {/* Debug panel */}
      <RenderDebugPanel
        isVisible={!!isTimelineLayoutDebugVisible}
        timeline={timeline}
        viewportState={{
          selectedLine: windowState.getCursorViewportLine(),
          lineScrollOffset: windowState.scrollTop,
          itemPositions: [], // Not used in this approach
          totalContentHeight: windowState.innerHeight,
          selectedItemIndex: windowState.selectedItemIndex,
          measurementTrigger,
        }}
        onClose={() => {}}
      />
    </Box>
  );
}