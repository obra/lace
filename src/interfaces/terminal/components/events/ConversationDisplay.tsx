// ABOUTME: Main conversation display component that renders thread events and ephemeral messages
// ABOUTME: Merges ThreadEvents and Messages chronologically for unified conversation view

import React from 'react';
import { Box } from 'ink';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../../../threads/types.js';
import { EventDisplay } from './EventDisplay.js';
import { ToolExecutionDisplay } from './ToolExecutionDisplay.js';
import MessageDisplay from '../message-display.js';

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

interface ConversationDisplayProps {
  events: ThreadEvent[];
  ephemeralMessages: Message[];
}

type ConversationItem = 
  | { type: 'event'; data: ThreadEvent }
  | { type: 'message'; data: Message }
  | { type: 'tool_execution'; callEvent: ThreadEvent; resultEvent?: ThreadEvent };

export function ConversationDisplay({ events, ephemeralMessages }: ConversationDisplayProps) {
  // Group tool calls with their results
  const groupedEvents = groupToolEvents(events);
  
  // Merge grouped events and messages chronologically
  const conversationItems: ConversationItem[] = [
    ...groupedEvents,
    ...ephemeralMessages.map(message => ({ type: 'message' as const, data: message }))
  ].sort((a, b) => {
    let timeA: Date;
    let timeB: Date;
    
    if (a.type === 'event') {
      timeA = a.data.timestamp;
    } else if (a.type === 'message') {
      timeA = a.data.timestamp;
    } else {
      timeA = a.callEvent.timestamp;
    }
    
    if (b.type === 'event') {
      timeB = b.data.timestamp;
    } else if (b.type === 'message') {
      timeB = b.data.timestamp;
    } else {
      timeB = b.callEvent.timestamp;
    }
    
    return timeA.getTime() - timeB.getTime();
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingY={1}>
      {conversationItems.map((item, index) => (
        <Box key={index}>
          {item.type === 'event' ? (
            <EventDisplay event={item.data} />
          ) : item.type === 'message' ? (
            <MessageDisplay message={item.data} />
          ) : (
            <ToolExecutionDisplay 
              callEvent={item.callEvent} 
              resultEvent={item.resultEvent}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}

function groupToolEvents(events: ThreadEvent[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const pendingToolCalls = new Map<string, ThreadEvent>();
  
  for (const event of events) {
    if (event.type === 'TOOL_CALL') {
      const toolCallData = event.data as ToolCallData;
      pendingToolCalls.set(toolCallData.callId, event);
      // Don't add to items yet - wait for result
    } else if (event.type === 'TOOL_RESULT') {
      const toolResultData = event.data as ToolResultData;
      const callEvent = pendingToolCalls.get(toolResultData.callId);
      
      if (callEvent) {
        // Add combined tool execution
        items.push({
          type: 'tool_execution',
          callEvent,
          resultEvent: event
        });
        pendingToolCalls.delete(toolResultData.callId);
      } else {
        // Orphaned result - show as regular event
        items.push({ type: 'event', data: event });
      }
    } else {
      // Regular event (not tool-related)
      items.push({ type: 'event', data: event });
    }
  }
  
  // Add any pending tool calls without results
  for (const callEvent of pendingToolCalls.values()) {
    items.push({
      type: 'tool_execution',
      callEvent,
      resultEvent: undefined
    });
  }
  
  return items;
}