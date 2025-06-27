// ABOUTME: Timeline content component for rendering timeline items list
// ABOUTME: Manages item refs, positioning, and coordinates between viewport state and item rendering

import React from 'react';
import { Box } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../thread-processor.js';
import { TimelineItem } from './TimelineItem.js';

interface ViewportState {
  focusedItemIndex: number;
  focusedLine: number;
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
  delegateTimelines?: Map<string, Timeline>;
  currentFocusId?: string;
}

export function TimelineContent({ 
  timeline, 
  viewportState, 
  viewportActions, 
  itemRefs, 
  delegateTimelines, 
  currentFocusId 
}: TimelineContentProps) {
  return (
    <React.Fragment>
      {timeline.items.map((item, index) => {
        const isItemFocused = index === viewportState.focusedItemIndex;
        return (
          <Box 
            key={`timeline-item-${index}`} 
            flexDirection="column"
            ref={(ref) => {
              if (ref && itemRefs?.current) {
                itemRefs.current.set(index, ref);
              } else if (!ref && itemRefs?.current) {
                itemRefs.current.delete(index);
              }
            }}
          >
            <TimelineItem 
              item={item} 
              delegateTimelines={delegateTimelines}
              isFocused={isItemFocused}
              focusedLine={viewportState.focusedLine}
              itemStartLine={viewportState.itemPositions[index] || 0}
              onToggle={viewportActions.triggerRemeasurement}
              currentFocusId={currentFocusId}
            />
          </Box>
        );
      })}
    </React.Fragment>
  );
}