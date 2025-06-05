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
  const [conversation, setConversation] = useState([
    { type: 'user' as const, content: 'Hello' },
    { type: 'assistant' as const, content: 'Hi! How can I help you today?' },
    { type: 'user' as const, content: 'Can you write a function?' },
    { type: 'assistant' as const, content: 'Sure! Here is a basic function:\n\nfunction hello() {\n  return "Hello World";\n}' }
  ]);
  const totalMessages = conversation.length;

  const submitMessage = () => {
    if (inputText.trim()) {
      setConversation(prev => [...prev, { type: 'user' as const, content: inputText.trim() }]);
      setInputText('');
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    if (!isNavigationMode) {
      // Input mode: handle text input and submission
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
      <StatusBar isNavigationMode={isNavigationMode} scrollPosition={scrollPosition} totalMessages={totalMessages} />
      <InputBar 
        isNavigationMode={isNavigationMode} 
        inputText={inputText}
        showCursor={true}
      />
    </Box>
  );
};

export default App;