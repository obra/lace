// ABOUTME: Display component for processed timeline items using extracted viewport component
// ABOUTME: Renders timeline content with item interaction handling, viewport managed by TimelineViewport

import React, { useState, useCallback } from 'react';
import { Box, useInput, useFocus, useFocusManager } from 'ink';
import { Timeline, TimelineItem } from '../../../thread-processor.js';
import { TimelineViewport } from './TimelineViewport.js';
import { TimelineContent } from './TimelineContent.js';
import { useDelegateThreadExtraction } from './hooks/useDelegateThreadExtraction.js';
import { logger } from '../../../../utils/logger.js';

interface TimelineDisplayProps {
  timeline: Timeline;
  delegateTimelines?: Map<string, Timeline>;
  focusId?: string;
  parentFocusId?: string; // Focus target when pressing escape
  bottomSectionHeight?: number;
}

export default function TimelineDisplay({ timeline, delegateTimelines, focusId, parentFocusId, bottomSectionHeight }: TimelineDisplayProps) {
  const [delegationExpandState, setDelegationExpandState] = useState<Map<string, boolean>>(new Map()); // Track expand/collapse state by callId
  const { isFocused } = useFocus({ id: focusId || 'timeline' });
  const { focus } = useFocusManager();
  const { extractDelegateThreadId } = useDelegateThreadExtraction(delegateTimelines);
  

  // Handle item-specific interactions
  const handleItemInteraction = useCallback((focusedItemIndex: number, input: string, key: any) => {
    if (focusedItemIndex >= 0 && focusedItemIndex < timeline.items.length) {
      const item = timeline.items[focusedItemIndex];
      
      if (item.type === 'tool_execution') {
        if (item.call?.toolName === 'delegate') {
          // Handle delegation items
          if (key.leftArrow || key.rightArrow) {
            // Toggle expand/collapse delegation box
            setDelegationExpandState(prev => {
              const newState = new Map(prev);
              const currentExpanded = newState.get(item.callId) ?? true;
              newState.set(item.callId, !currentExpanded);
              return newState;
            });
          } else if (key.return && delegateTimelines) {
            // Focus the delegation timeline
            const delegateThreadId = extractDelegateThreadId(item);
            if (delegateThreadId) {
              const targetFocusId = `delegate-${delegateThreadId}`;
              logger.debug('TimelineDisplay: Return key pressed - focusing delegation timeline', {
                currentFocusId: focusId || 'timeline',
                targetFocusId,
                delegateThreadId
              });
              focus(targetFocusId);
            }
          }
        }
      }
    }
  }, [timeline.items, delegateTimelines, focus, focusId, extractDelegateThreadId]);

  return (
    <TimelineViewport
      timeline={timeline}
      focusId={focusId}
      parentFocusId={parentFocusId}
      bottomSectionHeight={bottomSectionHeight}
      onItemInteraction={handleItemInteraction}
    >
      {({ timeline: tl, viewportState, viewportActions, itemRefs }) => 
        <TimelineContent
          timeline={tl}
          viewportState={viewportState}
          viewportActions={viewportActions}
          itemRefs={itemRefs}
          delegateTimelines={delegateTimelines}
          delegationExpandState={delegationExpandState}
          currentFocusId={focusId}
          extractDelegateThreadId={extractDelegateThreadId}
        />
      }
    </TimelineViewport>
  );
}