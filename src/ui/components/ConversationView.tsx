// ABOUTME: ConversationView component for displaying conversation content
// ABOUTME: Fills remaining space between top and StatusBar, scrollable content area

import React from 'react';
import { Box } from 'ink';
import Message from './Message';

// Test data for Step 3 as specified in the build plan
const mockConversation = [
  { type: 'user' as const, content: 'Hello' },
  { type: 'assistant' as const, content: 'Hi! How can I help you today?' },
  { type: 'user' as const, content: 'Can you write a function?' },
  { type: 'assistant' as const, content: 'Sure! Here is a basic function:\n\nfunction hello() {\n  return "Hello World";\n}' }
];

interface ConversationViewProps {
  scrollPosition?: number;
  isNavigationMode?: boolean;
  messages?: Array<{
    type: 'user' | 'assistant' | 'loading' | 'agent_activity' | 'streaming';
    content: string | string[];
    summary?: string;
    folded?: boolean;
    isStreaming?: boolean;
  }>;
  searchTerm?: string;
  searchResults?: { messageIndex: number; message: any }[];
}

/**
 * Calculate the visible window of messages for virtual scrolling
 * Only renders messages around the current scroll position to improve performance
 */
function getVisibleMessageWindow(
  messages: any[], 
  scrollPosition: number, 
  windowSize: number = 50
) {
  // For small conversations, render all messages
  if (messages.length <= windowSize) {
    return {
      visibleMessages: messages,
      startIndex: 0,
      endIndex: messages.length - 1
    };
  }

  // Calculate window bounds around scroll position
  const halfWindow = Math.floor(windowSize / 2);
  const startIndex = Math.max(0, scrollPosition - halfWindow);
  const endIndex = Math.min(messages.length - 1, scrollPosition + halfWindow);
  
  // Extract visible slice
  const visibleMessages = messages.slice(startIndex, endIndex + 1);
  
  return {
    visibleMessages,
    startIndex,
    endIndex
  };
}

const ConversationView: React.FC<ConversationViewProps> = ({ 
  scrollPosition = 0, 
  isNavigationMode = false,
  messages = mockConversation,
  searchTerm = '',
  searchResults = []
}) => {
  // Use virtual scrolling for large conversations
  const { visibleMessages, startIndex } = getVisibleMessageWindow(messages, scrollPosition);
  
  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      {visibleMessages.map((message, relativeIndex) => {
        const absoluteIndex = startIndex + relativeIndex;
        const isSearchResult = searchResults.some(result => result.messageIndex === absoluteIndex);
        return (
          <Message 
            key={`message-${absoluteIndex}-${message.type}`} 
            type={message.type} 
            content={message.content}
            summary={message.summary}
            folded={message.folded}
            isHighlighted={isNavigationMode && absoluteIndex === scrollPosition}
            searchTerm={searchTerm}
            isSearchResult={isSearchResult}
            isStreaming={message.isStreaming}
          />
        );
      })}
    </Box>
  );
};

export default ConversationView;