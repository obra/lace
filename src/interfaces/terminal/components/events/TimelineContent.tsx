// ABOUTME: Timeline content component for rendering timeline items list
// ABOUTME: Manages item refs, positioning, and coordinates between viewport state and item rendering

import React, { useRef, useCallback, useMemo } from 'react';
import { Box } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '~/interfaces/timeline-types.js';
import { TimelineItem } from '~/interfaces/terminal/components/events/TimelineItem.js';
import { TimelineItemRef } from '~/interfaces/terminal/components/timeline-item-focus.js';

interface ViewportState {
  selectedItemIndex: number;
  selectedLine: number;
  lineScrollOffset: number;
  itemPositions: number[];
  totalContentHeight: number;
  measurementTrigger: number;
}

interface ViewportActions {
  triggerRemeasurement: () => void;
}

interface TimelineContentProps {
  timeline: Timeline;
  viewportState: ViewportState;
  viewportActions: ViewportActions;
  itemRefs: React.MutableRefObject<Map<number, unknown>>;
  viewportLines: number;
}

// Helper function to get stable key for timeline items
function getTimelineItemKey(item: TimelineItemType, index: number): string {
  switch (item.type) {
    case 'user_message':
    case 'agent_message':
    case 'system_message':
      return `timeline-item-${item.id}`;
    case 'tool_execution':
      return `timeline-item-${item.callId}`;
    case 'ephemeral_message':
      // For ephemeral messages without IDs, use timestamp + index as fallback
      return `timeline-item-ephemeral-${item.timestamp.getTime()}-${index}`;
    default:
      return `timeline-item-${index}`;
  }
}

export function TimelineContent({
  timeline,
  viewportState,
  viewportActions,
  itemRefs,
  viewportLines,
}: TimelineContentProps) {
  // Only render items that fit in viewport + small buffer for fast startup
  const itemsToRender = useMemo(() => {
    const buffer = 5;
    const maxItems = viewportLines + buffer;

    if (timeline.items.length <= maxItems) {
      return timeline.items.map((item, index) => ({ item, originalIndex: index }));
    }

    // Only render the most recent items
    const startIndex = timeline.items.length - maxItems;
    return timeline.items.slice(startIndex).map((item, index) => ({
      item,
      originalIndex: startIndex + index,
    }));
  }, [timeline.items, viewportLines]);

  return (
    <React.Fragment>
      {itemsToRender.map(({ item, originalIndex }) => {
        const isItemSelected = originalIndex === viewportState.selectedItemIndex;
        return (
          <Box
            key={getTimelineItemKey(item, originalIndex)}
            flexDirection="column"
            ref={(ref) => {
              if (ref) {
                itemRefs.current.set(originalIndex, ref);
              } else {
                itemRefs.current.delete(originalIndex);
              }
            }}
          >
            <TimelineItem
              item={item}
              isSelected={isItemSelected}
              selectedLine={viewportState.selectedLine}
              itemStartLine={viewportState.itemPositions[originalIndex] || 0}
              onToggle={viewportActions.triggerRemeasurement}
            />
          </Box>
        );
      })}
    </React.Fragment>
  );
}
