// ABOUTME: Timeline content component for rendering timeline items list
// ABOUTME: Manages item refs, positioning, and coordinates between viewport state and item rendering

import React, { useRef, useCallback, useMemo } from 'react';
import { Box } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../thread-processor.js';
import { TimelineItem } from './TimelineItem.js';
import { TimelineItemRef } from '../timeline-item-focus.js';

interface ViewportState {
  selectedItemIndex: number;
  selectedLine: number;
  itemPositions: number[];
}

interface ViewportActions {
  triggerRemeasurement: () => void;
}

interface TimelineContentProps {
  timeline: Timeline;
  viewportState: ViewportState;
  viewportActions: ViewportActions;
  itemRefs: React.MutableRefObject<Map<number, unknown>>;
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
}: TimelineContentProps) {
  return (
    <React.Fragment>
      {timeline.items.map((item, index) => {
        const isItemSelected = index === viewportState.selectedItemIndex;
        return (
          <Box
            key={getTimelineItemKey(item, index)}
            flexDirection="column"
            ref={(ref) => {
              if (ref) {
                itemRefs.current.set(index, ref);
              } else {
                itemRefs.current.delete(index);
              }
            }}
          >
            <TimelineItem
              item={item}
              isSelected={isItemSelected}
              selectedLine={viewportState.selectedLine}
              itemStartLine={viewportState.itemPositions[index] || 0}
              onToggle={viewportActions.triggerRemeasurement}
            />
          </Box>
        );
      })}
    </React.Fragment>
  );
}
