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
  const totalMessages = 4;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    if (!isNavigationMode) {
      // Input mode: Enter to enter navigation mode
      if (key.return) {
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
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <ConversationView scrollPosition={scrollPosition} isNavigationMode={isNavigationMode} />
      <StatusBar isNavigationMode={isNavigationMode} scrollPosition={scrollPosition} totalMessages={totalMessages} />
      <InputBar isNavigationMode={isNavigationMode} />
    </Box>
  );
};

export default App;