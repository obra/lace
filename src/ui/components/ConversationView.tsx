// ABOUTME: ConversationView component for displaying conversation content
// ABOUTME: Fills remaining space between top and StatusBar, scrollable content area

import React from 'react';
import { Text, Box } from 'ink';

const ConversationView: React.FC = () => {
  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Text color="dim">Conversation will appear here...</Text>
      <Text color="dim">Ready for messages and responses.</Text>
    </Box>
  );
};

export default ConversationView;