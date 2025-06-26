// ABOUTME: Display component for processed timeline items using extracted viewport component
// ABOUTME: Renders timeline content with item interaction handling, viewport managed by TimelineViewport

import React, { useState, useCallback } from 'react';
import { Box, useInput, useFocus, useFocusManager } from 'ink';
import { Timeline, TimelineItem } from '../../../thread-processor.js';
import { TimelineViewport } from './TimelineViewport.js';
import { TimelineItem as TimelineItemComponent } from './TimelineItem.js';
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
  const [toolExpandState, setToolExpandState] = useState<Map<string, boolean>>(new Map()); // Track tool expand/collapse state by callId
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
        } else {
          // Handle regular tool execution items
          if (key.leftArrow || key.rightArrow) {
            // Toggle expand/collapse tool execution
            setToolExpandState(prev => {
              const newState = new Map(prev);
              const currentExpanded = newState.get(item.callId) ?? false;
              newState.set(item.callId, !currentExpanded);
              return newState;
            });
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
        tl.items.map((item, index) => {
            const isItemFocused = index === viewportState.focusedItemIndex;
            return (
              <Box 
                key={`timeline-item-${index}`} 
                flexDirection="column"
                ref={(ref) => {
                  if (ref) {
                    itemRefs.current.set(index, ref);
                  } else {
                    itemRefs.current.delete(index);
                  }
                }}
              >
                <TimelineItemComponent 
                  item={item} 
                  delegateTimelines={delegateTimelines}
                  isFocused={isItemFocused}
                  focusedLine={viewportState.focusedLine}
                  itemStartLine={viewportState.itemPositions[index] || 0}
                  onToggle={viewportActions.triggerRemeasurement}
                  delegationExpandState={delegationExpandState}
                  toolExpandState={toolExpandState}
                  currentFocusId={focusId}
                  extractDelegateThreadId={extractDelegateThreadId}
                />
              </Box>
            );
          })
      }
    </TimelineViewport>
  );
}