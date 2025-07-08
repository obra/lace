// ABOUTME: Timeline content component for rendering timeline items within a sliding window
// ABOUTME: Implements virtualization by only rendering items visible in the current window

import React, { useCallback } from 'react';
import { Box } from 'ink';
import { TimelineItem as TimelineItemType } from '../../../timeline-types.js';
import { TimelineItem } from './TimelineItem.js';
import { TimelineWindowState } from './hooks/useTimelineWindow.js';

interface ViewportActions {
  triggerRemeasurement: () => void;
}

interface TimelineContentProps {
  windowState: Pick<TimelineWindowState, 
    'selectedItemIndex' | 
    'selectedLineInItem' | 
    'itemHeights' |
    'getWindowItems' |
    'getCursorViewportLine'
  >;
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
  windowState,
  viewportActions,
  itemRefs,
}: TimelineContentProps) {
  const { 
    selectedItemIndex, 
    selectedLineInItem,
    getWindowItems,
  } = windowState;

  // Get all items (Ink will clip with overflow)
  const allItems = getWindowItems();

  // Helper to calculate if an item is selected
  const isItemSelected = useCallback((index: number): boolean => {
    return index === selectedItemIndex;
  }, [selectedItemIndex]);

  return (
    <React.Fragment>
      {allItems.map((item, index) => {
        const isSelected = isItemSelected(index);
        
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
              isSelected={isSelected}
              selectedLine={isSelected ? selectedLineInItem : 0}
              itemStartLine={0} // Not used anymore
              onToggle={viewportActions.triggerRemeasurement}
            />
          </Box>
        );
      })}
    </React.Fragment>
  );
}