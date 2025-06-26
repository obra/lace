// ABOUTME: Display component for processed timeline items using extracted viewport component
// ABOUTME: Renders timeline content with item interaction handling, viewport managed by TimelineViewport

import React, { useState, useCallback } from 'react';
import { Box, useInput, useFocus, useFocusManager } from 'ink';
import { Timeline, TimelineItem } from '../../../thread-processor.js';
import { EventDisplay } from './EventDisplay.js';
import { ToolExecutionDisplay } from './ToolExecutionDisplay.js';
import { DelegationBox } from './DelegationBox.js';
import MessageDisplay from '../message-display.js';
import { TimelineViewport } from './TimelineViewport.js';
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
            const delegateThreadId = extractDelegateThreadId(item, delegateTimelines);
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
  }, [timeline.items, delegateTimelines, focus, focusId]);

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
                <TimelineItemDisplay 
                  item={item} 
                  delegateTimelines={delegateTimelines}
                  isFocused={isItemFocused}
                  focusedLine={viewportState.focusedLine}
                  itemStartLine={viewportState.itemPositions[index] || 0}
                  onToggle={viewportActions.triggerRemeasurement}
                  delegationExpandState={delegationExpandState}
                  toolExpandState={toolExpandState}
                  currentFocusId={focusId}
                />
              </Box>
            );
          })
      }
    </TimelineViewport>
  );
}

function TimelineItemDisplay({ item, delegateTimelines, isFocused, focusedLine, itemStartLine, onToggle, delegationExpandState, toolExpandState, currentFocusId }: { 
  item: TimelineItem; 
  delegateTimelines?: Map<string, Timeline>;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  delegationExpandState: Map<string, boolean>;
  toolExpandState: Map<string, boolean>;
  currentFocusId?: string;
}) {
  switch (item.type) {
    case 'user_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'USER_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'agent_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'AGENT_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'thinking':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'THINKING',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'system_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: (item.originalEventType || 'LOCAL_SYSTEM_MESSAGE') as any,
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'tool_execution':
      const callEvent = {
        id: `${item.callId}-call`,
        threadId: '',
        type: 'TOOL_CALL' as const,
        timestamp: item.timestamp,
        data: item.call
      };
      
      const resultEvent = item.result ? {
        id: `${item.callId}-result`,
        threadId: '',
        type: 'TOOL_RESULT' as const,
        timestamp: item.timestamp,
        data: item.result
      } : undefined;
      
      // Check if this is a delegate tool call
      if (item.call.toolName === 'delegate') {
        logger.debug('TimelineDisplay: Processing delegate tool call', { 
          callId: item.callId,
          toolName: item.call.toolName,
          hasDelegateTimelines: !!delegateTimelines,
          delegateTimelineCount: delegateTimelines?.size || 0
        });
        
        if (delegateTimelines) {
          const delegateThreadId = extractDelegateThreadId(item, delegateTimelines);
          logger.debug('TimelineDisplay: Delegate thread ID extraction result', {
            callId: item.callId,
            extractedThreadId: delegateThreadId,
            availableThreads: Array.from(delegateTimelines.keys()),
            toolResult: item.result?.output ? item.result.output.substring(0, 100) + '...' : 'no result'
          });
          
          const delegateTimeline = delegateThreadId ? delegateTimelines.get(delegateThreadId) : null;
          
          if (delegateTimeline && delegateThreadId) {
            const isExpanded = delegationExpandState.get(item.callId) ?? true;
            logger.debug('TimelineDisplay: RENDERING delegation box', { 
              threadId: delegateThreadId,
              callId: item.callId,
              isExpanded,
              timelineItemCount: delegateTimeline.items.length
            });
            return (
              <Box flexDirection="column">
                <ToolExecutionDisplay 
                  callEvent={callEvent} 
                  resultEvent={resultEvent}
                  isFocused={isFocused}
                  isExpanded={false} // Tool part always collapsed for delegate calls
                />
                <DelegationBox 
                  threadId={delegateThreadId}
                  timeline={delegateTimeline}
                  delegateTimelines={delegateTimelines}
                  expanded={isExpanded}
                  parentFocusId={currentFocusId || 'timeline'}
                />
              </Box>
            );
          } else {
            logger.debug('TimelineDisplay: NOT rendering delegation box', {
              reason: 'missing timeline or threadId',
              callId: item.callId,
              delegateThreadId,
              hasTimeline: !!delegateTimeline,
              hasDelegateTimelines: !!delegateTimelines,
              delegateTimelineKeys: delegateTimelines ? Array.from(delegateTimelines.keys()) : []
            });
          }
        } else {
          logger.debug('TimelineDisplay: No delegate timelines provided', {
            callId: item.callId,
            toolName: item.call.toolName
          });
        }
      }
      
      const isToolExpanded = toolExpandState.get(item.callId) ?? false;
      return <ToolExecutionDisplay 
        callEvent={callEvent} 
        resultEvent={resultEvent}
        isFocused={isFocused}
        isExpanded={isToolExpanded}
      />;
      
    case 'ephemeral_message':
      return <MessageDisplay 
        message={{
          type: item.messageType as any,
          content: item.content,
          timestamp: item.timestamp
        }} 
        isFocused={isFocused}
      />;
      
      
    default:
      return <Box>Unknown timeline item type</Box>;
  }
}

// Helper function to extract delegate thread ID from tool execution
function extractDelegateThreadId(
  item: Extract<TimelineItem, { type: 'tool_execution' }>,
  delegateTimelines: Map<string, Timeline>
): string | null {
  logger.debug('Extracting delegate thread ID', { callId: item.callId });
  
  // Strategy 1: Look for thread ID in tool result
  if (item.result && typeof item.result.output === 'string') {
    const match = item.result.output.match(/Thread: ([^\)]+)/);
    if (match) {
      logger.debug('Found thread ID in tool result', { threadId: match[1] });
      return match[1];
    }
  }
  
  // Strategy 2: Find delegate thread that started near this tool call (within 5 seconds)
  for (const [threadId, timeline] of delegateTimelines.entries()) {
    const firstItem = timeline.items[0];
    if (firstItem) {
      const timeDiff = Math.abs(firstItem.timestamp.getTime() - item.timestamp.getTime());
      if (timeDiff < 5000) {
        logger.debug('Found delegate thread by temporal proximity', {
          threadId,
          timeDiffMs: timeDiff
        });
        return threadId;
      }
    }
  }
  
  logger.debug('No delegate thread ID found');
  return null;
}
