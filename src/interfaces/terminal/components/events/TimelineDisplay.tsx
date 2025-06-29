// ABOUTME: Display component for processed timeline items using extracted viewport component
// ABOUTME: Renders timeline content with item interaction handling, viewport managed by TimelineViewport

import React, { useState, useCallback } from 'react';
import { Box, useInput, useFocus, useFocusManager } from 'ink';
import { Timeline, TimelineItem } from '../../../thread-processor.js';
import { TimelineViewport } from './TimelineViewport.js';
import { TimelineContent } from './TimelineContent.js';
import { useExpansionExpand, useExpansionCollapse } from './hooks/useTimelineExpansionToggle.js';

interface TimelineDisplayProps {
  timeline: Timeline;
  focusId?: string;
  parentFocusId?: string; // Focus target when pressing escape
  bottomSectionHeight?: number;
}

export default function TimelineDisplay({
  timeline,
  focusId,
  parentFocusId,
  bottomSectionHeight,
}: TimelineDisplayProps) {
  const { isFocused } = useFocus({ id: focusId || 'timeline' });
  const { focus } = useFocusManager();
  
  // Get expansion emitters
  const emitExpand = useExpansionExpand();
  const emitCollapse = useExpansionCollapse();

  // Handle item-specific interactions
  const handleItemInteraction = useCallback(
    (selectedItemIndex: number, input: string, key: any) => {
      if (key.leftArrow) {
        // Left arrow collapses the selected item
        emitCollapse();
      } else if (key.rightArrow) {
        // Right arrow expands the selected item
        emitExpand();
      }
      // Other interactions (return key, etc.) can be handled here in the future
    },
    [emitCollapse, emitExpand]
  );

  return (
    <TimelineViewport
      timeline={timeline}
      focusId={focusId}
      parentFocusId={parentFocusId}
      bottomSectionHeight={bottomSectionHeight}
      onItemInteraction={handleItemInteraction}
    >
      {({ timeline: tl, viewportState, viewportActions, itemRefs }) => (
        <TimelineContent
          timeline={tl}
          viewportState={viewportState}
          viewportActions={viewportActions}
          itemRefs={itemRefs}
          currentFocusId={focusId}
        />
      )}
    </TimelineViewport>
  );
}
