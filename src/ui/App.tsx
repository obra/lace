// ABOUTME: Main Ink application component for Lace terminal UI
// ABOUTME: Implements full-window layout with ConversationView, StatusBar, and InputBar

import React from 'react';
import { Box } from 'ink';
import ConversationView from './components/ConversationView';
import StatusBar from './components/StatusBar';
import InputBar from './components/InputBar';

const App: React.FC = () => {
  return (
    <Box flexDirection="column" height="100%">
      <ConversationView />
      <StatusBar />
      <InputBar />
    </Box>
  );
};

export default App;