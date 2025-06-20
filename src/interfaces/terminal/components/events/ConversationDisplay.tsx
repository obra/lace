// ABOUTME: Main conversation display component that renders thread events and ephemeral messages
// ABOUTME: Merges ThreadEvents and Messages chronologically for unified conversation view

import React from 'react';
import { Box } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { EventDisplay } from './EventDisplay.js';
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
  | { type: 'message'; data: Message };

export function ConversationDisplay({ events, ephemeralMessages }: ConversationDisplayProps) {
  // Merge events and messages chronologically
  const conversationItems: ConversationItem[] = [
    ...events.map(event => ({ type: 'event' as const, data: event })),
    ...ephemeralMessages.map(message => ({ type: 'message' as const, data: message }))
  ].sort((a, b) => {
    const timeA = a.type === 'event' ? a.data.timestamp : a.data.timestamp;
    const timeB = b.type === 'event' ? b.data.timestamp : b.data.timestamp;
    return timeA.getTime() - timeB.getTime();
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingY={1}>
      {conversationItems.map((item, index) => (
        <Box key={index}>
          {item.type === 'event' ? (
            <EventDisplay event={item.data} />
          ) : (
            <MessageDisplay message={item.data} />
          )}
        </Box>
      ))}
    </Box>
  );
}