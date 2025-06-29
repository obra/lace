// ABOUTME: Display component for processed timeline items using extracted viewport component
// ABOUTME: Renders timeline content with item interaction handling, viewport managed by TimelineViewport

import React, { useCallback } from 'react';
import { Timeline } from '../../../thread-processor.js';
import { TimelineViewport } from './TimelineViewport.js';
import { TimelineContent } from './TimelineContent.js';
import { useExpansionExpand, useExpansionCollapse, useTimelineFocusEntry } from './hooks/useTimelineExpansionToggle.js';
import { canTimelineItemAcceptFocus } from '../timeline-item-focus.js';
import { TimelineItemRef } from '../timeline-item-focus.js';
import { logger } from '../../../../utils/logger.js';

interface TimelineDisplayProps {
  timeline: Timeline;
  bottomSectionHeight?: number;
  focusRegion?: string; // Optional focus region ID for timeline viewport
}

export default function TimelineDisplay({
  timeline,
  bottomSectionHeight,
  focusRegion,
}: TimelineDisplayProps) {
  // Get expansion and focus entry emitters
  const emitExpand = useExpansionExpand();
  const emitCollapse = useExpansionCollapse();
  const emitFocusEntry = useTimelineFocusEntry();

  // Handle item-specific interactions
  const handleItemInteraction = useCallback(
    (selectedItemIndex: number, input: string, key: any, itemRefs?: React.MutableRefObject<Map<number, any>>) => {
      logger.debug('TimelineDisplay: handleItemInteraction called', {
        selectedItemIndex,
        key: Object.keys(key).filter(k => (key as any)[k]).join('+'),
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
          selectedItem: selectedItem ? { type: selectedItem.type, timestamp: selectedItem.timestamp } : null,
          canAcceptFocus: selectedItem ? canTimelineItemAcceptFocus(selectedItem) : false,
        });
        
        if (selectedItem && canTimelineItemAcceptFocus(selectedItem)) {
          // Emit a focus entry event that the DelegateToolRenderer can listen for
          logger.debug('TimelineDisplay: Emitting timeline focus entry event', {
            selectedItemIndex,
            selectedItemType: selectedItem.type,
            selectedItemCallName: (selectedItem as any).call?.name,
          });
          
          // Emit focus entry event to the selected timeline item
          emitFocusEntry();
        } else {
          logger.debug('TimelineDisplay: Item cannot accept focus or does not exist');
        }
      }
    },
    [emitCollapse, emitExpand, emitFocusEntry, timeline.items]
  );

  return (
    <TimelineViewport
      timeline={timeline}
      bottomSectionHeight={bottomSectionHeight}
      focusRegion={focusRegion}
      onItemInteraction={handleItemInteraction}
    >
      {({ timeline: tl, viewportState, viewportActions, itemRefs }) => (
        <TimelineContent
          timeline={tl}
          viewportState={viewportState}
          viewportActions={viewportActions}
          itemRefs={itemRefs}
        />
      )}
    </TimelineViewport>
  );
}
