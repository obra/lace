// ABOUTME: Display component for processed timeline items using extracted viewport component
// ABOUTME: Renders timeline content with item interaction handling, viewport managed by TimelineViewport

import React, { useCallback } from 'react';
import { Timeline } from '~/interfaces/timeline-types';
import { TimelineViewport } from '~/interfaces/terminal/components/events/TimelineViewport';
import { TimelineContent } from '~/interfaces/terminal/components/events/TimelineContent';
import {
  useExpansionExpand,
  useExpansionCollapse,
  useTimelineFocusEntry,
} from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';
import { canTimelineItemAcceptFocus } from '~/interfaces/terminal/components/timeline-item-focus';
import { logger } from '~/utils/logger';

interface TimelineDisplayProps {
  timeline: Timeline;
  bottomSectionHeight?: number;
  focusRegion?: string; // Optional focus region ID for timeline viewport
  isTimelineLayoutDebugVisible?: boolean;
}

export default function TimelineDisplay({
  timeline,
  bottomSectionHeight,
  focusRegion,
  isTimelineLayoutDebugVisible,
}: TimelineDisplayProps) {
  // Get expansion and focus entry emitters
  const emitExpand = useExpansionExpand();
  const emitCollapse = useExpansionCollapse();
  const emitFocusEntry = useTimelineFocusEntry();

  // Handle item-specific interactions
  const handleItemInteraction = useCallback(
    (
      selectedItemIndex: number,
      input: string,
      key: {
        leftArrow?: boolean;
        rightArrow?: boolean;
        return?: boolean;
        [key: string]: boolean | undefined;
      },
      _itemRefs?: React.MutableRefObject<Map<number, unknown>>
    ) => {
      logger.debug('TimelineDisplay: handleItemInteraction called', {
        selectedItemIndex,
        key: Object.keys(key)
          .filter((k) => key[k as keyof typeof key])
          .join('+'),
        focusRegion,
      });

      if (key.leftArrow) {
        // Left arrow collapses the selected item
        logger.debug('TimelineDisplay: Emitting collapse event', { focusRegion });
        emitCollapse();
      } else if (key.rightArrow) {
        // Right arrow expands the selected item
        logger.debug('TimelineDisplay: Emitting expand event', { focusRegion });
        emitExpand();
      } else if (key.return) {
        // Return key enters focusable timeline items
        const selectedItem = timeline.items[selectedItemIndex];
        logger.debug('TimelineDisplay: Return key pressed', {
          selectedItemIndex,
          selectedItem: selectedItem
            ? { type: selectedItem.type, timestamp: selectedItem.timestamp }
            : null,
          canAcceptFocus: selectedItem ? canTimelineItemAcceptFocus(selectedItem) : false,
        });

        if (selectedItem && canTimelineItemAcceptFocus(selectedItem)) {
          // Focus implies expansion - expand the item before entering focus mode
          logger.debug('TimelineDisplay: Emitting expand and focus entry events', {
            selectedItemIndex,
            selectedItemType: selectedItem.type,
            selectedItemCallName:
              selectedItem.type === 'tool_execution' ? selectedItem.call.name : undefined,
          });

          // First expand the item (focus implies expansion)
          emitExpand();

          // Then emit focus entry event to the selected timeline item
          emitFocusEntry();
        } else {
          logger.debug('TimelineDisplay: Item cannot accept focus or does not exist');
        }
      }
    },
    [emitCollapse, emitExpand, emitFocusEntry, timeline.items.length]
  );

  return (
    <TimelineViewport
      timeline={timeline}
      bottomSectionHeight={bottomSectionHeight}
      focusRegion={focusRegion}
      onItemInteraction={handleItemInteraction}
      isTimelineLayoutDebugVisible={isTimelineLayoutDebugVisible}
    >
      {({ timeline: tl, viewportState, viewportActions, itemRefs, viewportLines }) => (
        <TimelineContent
          timeline={tl}
          viewportState={viewportState}
          viewportActions={viewportActions}
          itemRefs={itemRefs}
          viewportLines={viewportLines}
        />
      )}
    </TimelineViewport>
  );
}
