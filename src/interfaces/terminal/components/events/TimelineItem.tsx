// ABOUTME: Individual timeline item component with type-specific rendering logic
// ABOUTME: Handles all timeline item types: user_message, agent_message, thinking, system_message, tool_execution, ephemeral_message

import React from 'react';
import { Box, Text } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../thread-processor.js';
import { EventDisplay } from './EventDisplay.js';
import { ToolExecutionDisplay } from './ToolExecutionDisplay.js';
import { DelegationBox } from './DelegationBox.js';
import MessageDisplay from '../message-display.js';
import { logger } from '../../../../utils/logger.js';

interface TimelineItemProps {
  item: TimelineItemType;
  delegateTimelines?: Map<string, Timeline>;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  delegationExpandState: Map<string, boolean>;
  currentFocusId?: string;
  extractDelegateThreadId: (item: Extract<TimelineItemType, { type: 'tool_execution' }>) => string | null;
}

export function TimelineItem({ 
  item, 
  delegateTimelines, 
  isFocused, 
  focusedLine, 
  itemStartLine, 
  onToggle, 
  delegationExpandState, 
  currentFocusId, 
  extractDelegateThreadId 
}: TimelineItemProps) {
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
        logger.debug('TimelineItem: Processing delegate tool call', { 
          callId: item.callId,
          toolName: item.call.toolName,
          hasDelegateTimelines: !!delegateTimelines,
          delegateTimelineCount: delegateTimelines?.size || 0
        });
        
        if (delegateTimelines) {
          const delegateThreadId = extractDelegateThreadId(item);
          logger.debug('TimelineItem: Delegate thread ID extraction result', {
            callId: item.callId,
            extractedThreadId: delegateThreadId,
            availableThreads: Array.from(delegateTimelines.keys()),
            toolResult: item.result?.output ? item.result.output.substring(0, 100) + '...' : 'no result'
          });
          
          const delegateTimeline = delegateThreadId ? delegateTimelines.get(delegateThreadId) : null;
          
          if (delegateTimeline && delegateThreadId) {
            const isExpanded = delegationExpandState.get(item.callId) ?? true;
            logger.debug('TimelineItem: RENDERING delegation box', { 
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
                  onToggle={onToggle}
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
            logger.debug('TimelineItem: NOT rendering delegation box', {
              reason: 'missing timeline or threadId',
              callId: item.callId,
              delegateThreadId,
              hasTimeline: !!delegateTimeline,
              hasDelegateTimelines: !!delegateTimelines,
              delegateTimelineKeys: delegateTimelines ? Array.from(delegateTimelines.keys()) : []
            });
          }
        } else {
          logger.debug('TimelineItem: No delegate timelines provided', {
            callId: item.callId,
            toolName: item.call.toolName
          });
        }
      }
      
      return <ToolExecutionDisplay 
        callEvent={callEvent} 
        resultEvent={resultEvent}
        isFocused={isFocused}
        onToggle={onToggle}
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
      return <Box><Text>Unknown timeline item type</Text></Box>;
  }
}