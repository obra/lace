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
    type: 'user' | 'assistant' | 'loading' | 'agent_activity';
    content: string | string[];
    summary?: string;
    folded?: boolean;
  }>;
  searchTerm?: string;
  searchResults?: { messageIndex: number; message: any }[];
}

const ConversationView: React.FC<ConversationViewProps> = ({ 
  scrollPosition = 0, 
  isNavigationMode = false,
  messages = mockConversation,
  searchTerm = '',
  searchResults = []
}) => {
  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      {messages.map((message, index) => {
        const isSearchResult = searchResults.some(result => result.messageIndex === index);
        return (
          <Message 
            key={`message-${index}-${message.type}`} 
            type={message.type} 
            content={message.content}
            summary={message.summary}
            folded={message.folded}
            isHighlighted={isNavigationMode && index === scrollPosition}
            searchTerm={searchTerm}
            isSearchResult={isSearchResult}
          />
        );
      })}
    </Box>
  );
};

export default ConversationView;