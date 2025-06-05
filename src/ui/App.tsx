// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Implements full-window layout with ConversationView, StatusBar, and InputBar

import React, { useState } from 'react';
// @ts-expect-error - useInput is available at runtime but TypeScript has module resolution issues
import { Box, useInput } from 'ink';
import ConversationView from './components/ConversationView';
import StatusBar from './components/StatusBar';
import InputBar from './components/InputBar';

const App: React.FC = () => {
  const [isNavigationMode, setIsNavigationMode] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversation, setConversation] = useState([
    { type: 'user' as const, content: 'Hello' },
    { type: 'assistant' as const, content: 'Hi! How can I help you today?' },
    { 
      type: 'agent_activity' as const,
      summary: 'Agent Activity - 2 items',
      content: [
        '🤖 orchestrator → delegating to coder agent',
        '🔨 coder → analyzing auth patterns (active)'
      ],
      folded: true
    },
    { type: 'user' as const, content: 'Can you write a function?' },
    { type: 'assistant' as const, content: 'Sure! Here is a basic function:\n\n```javascript\nfunction hello() {\n  return "Hello World";\n}\n```' }
  ]);
  const totalMessages = conversation.length;

  const mockResponses = [
    'Hi! How can I help you today?',
    'I\'d be happy to assist you with that.',
    'That\'s an interesting question! Let me think about it.',
    'Here\'s what I can help you with...',
    'I understand what you\'re asking. Let me provide some insight.',
    'Great question! Here\'s my response to that.',
    'I can definitely help you with this task.',
    'Let me break this down for you step by step.'
  ];

  const getRandomResponse = () => {
    return mockResponses[Math.floor(Math.random() * mockResponses.length)];
  };

  const submitMessage = () => {
    if (inputText.trim() && !isLoading) {
      // Add user message
      setConversation(prev => [...prev, { type: 'user' as const, content: inputText.trim() }]);
      setInputText('');
      
      // Start loading state
      setIsLoading(true);
      setConversation(prev => [...prev, { type: 'loading' as const, content: 'Assistant is thinking...' }]);
      
      // Simulate agent response after delay
      setTimeout(() => {
        setConversation(prev => {
          // Remove loading message and add agent response
          const withoutLoading = prev.slice(0, -1);
          return [...withoutLoading, { type: 'assistant' as const, content: getRandomResponse() }];
        });
        setIsLoading(false);
      }, 1500); // 1.5 second delay
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    if (!isNavigationMode && !isLoading) {
      // Input mode: handle text input and submission (disabled during loading)
      if (key.return) {
        if (inputText.trim()) {
          // Submit message if input has content
          submitMessage();
        } else {
          // Enter navigation mode if input is empty
          setIsNavigationMode(true);
          setScrollPosition(0);
        }
      } else if (key.backspace || key.delete) {
        // Handle backspace/delete
        setInputText(prev => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta && input.length === 1) {
        // Handle regular character input
        setInputText(prev => prev + input);
      }
    } else if (!isNavigationMode && isLoading) {
      // During loading, only allow entering navigation mode with empty input
      if (key.return && !inputText.trim()) {
        setIsNavigationMode(true);
        setScrollPosition(0);
      }
    } else {
      // Navigation mode
      if (key.escape) {
        // Escape to exit navigation mode
        setIsNavigationMode(false);
        setScrollPosition(0);
      } else if (input === 'j' || key.downArrow) {
        // j or down arrow to scroll down
        setScrollPosition(prev => Math.min(prev + 1, totalMessages - 1));
      } else if (input === 'k' || key.upArrow) {
        // k or up arrow to scroll up
        setScrollPosition(prev => Math.max(prev - 1, 0));
      } else if (input === ' ') {
        // Space key to toggle fold state of current message
        const currentMessage = conversation[scrollPosition];
        if (currentMessage && currentMessage.type === 'agent_activity') {
          setConversation(prev => prev.map((msg, index) => 
            index === scrollPosition 
              ? { ...msg, folded: !msg.folded }
              : msg
          ));
        }
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <ConversationView 
        scrollPosition={scrollPosition} 
        isNavigationMode={isNavigationMode} 
        messages={conversation}
      />
      <StatusBar 
        isNavigationMode={isNavigationMode} 
        scrollPosition={scrollPosition} 
        totalMessages={totalMessages} 
        isLoading={isLoading}
      />
      <InputBar 
        isNavigationMode={isNavigationMode} 
        inputText={inputText}
        showCursor={true}
      />
    </Box>
  );
};

export default App;