// ABOUTME: Individual timeline item component with type-specific rendering logic
// ABOUTME: Handles all timeline item types: user_message, agent_message, thinking, system_message, tool_execution, ephemeral_message

import React from 'react';
import { Box, Text } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../thread-processor.js';
import { EventDisplay } from './EventDisplay.js';
import { ToolExecutionDisplay } from './ToolExecutionDisplay.js';
import { DelegationBox } from './DelegationBox.js';
import MessageDisplay from '../message-display.js';

interface TimelineItemProps {
  item: TimelineItemType;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  currentFocusId?: string;
}

export function TimelineItem({ 
  item, 
  isFocused, 
  focusedLine, 
  itemStartLine, 
  onToggle, 
  currentFocusId
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
        return (
          <Box flexDirection="column">
            <ToolExecutionDisplay 
              callEvent={callEvent} 
              resultEvent={resultEvent}
              isFocused={isFocused}
              onToggle={onToggle}
            />
            <DelegationBox 
              toolCall={item}
              parentFocusId={currentFocusId || 'timeline'}
              onToggle={onToggle}
            />
          </Box>
        );
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