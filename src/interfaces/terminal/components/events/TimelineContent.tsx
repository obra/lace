// ABOUTME: Timeline content component for rendering timeline items list
// ABOUTME: Manages item refs, positioning, and coordinates between viewport state and item rendering

import React from 'react';
import { Box } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../thread-processor.js';
import { TimelineItem } from './TimelineItem.js';

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
              isSelected={isItemSelected}
              isFocused={false} // TODO: Implement individual item focus
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
