// ABOUTME: Display component for processed timeline items from ThreadProcessor
// ABOUTME: Renders timeline items in chronological order with appropriate UI components

import React from 'react';
import { Box } from 'ink';
import { Timeline, TimelineItem } from '../../../thread-processor.js';
import { EventDisplay } from './EventDisplay.js';
import { ToolExecutionDisplay } from './ToolExecutionDisplay.js';
import MessageDisplay from '../message-display.js';

interface TimelineDisplayProps {
  timeline: Timeline;
}

export default function TimelineDisplay({ timeline }: TimelineDisplayProps) {
  return (
    <Box flexDirection="column">
      {timeline.items.map((item, index) => (
        <Box key={`timeline-item-${index}`}>
          <TimelineItemDisplay item={item} />
        </Box>
      ))}
    </Box>
  );
}

function TimelineItemDisplay({ item }: { item: TimelineItem }) {
  switch (item.type) {
    case 'user_message':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'USER_MESSAGE',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
    case 'agent_message':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'AGENT_MESSAGE',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
    case 'thinking':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'THINKING',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
    case 'system_message':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'LOCAL_SYSTEM_MESSAGE',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
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
      
      return <ToolExecutionDisplay 
        callEvent={callEvent} 
        resultEvent={resultEvent}
      />;
      
    case 'ephemeral_message':
      return <MessageDisplay message={{
        type: item.messageType as any,
        content: item.content,
        timestamp: item.timestamp
      }} />;
      
    default:
      return <Box>Unknown timeline item type</Box>;
  }
}