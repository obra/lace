// ABOUTME: StatusBar component for displaying basic status information
// ABOUTME: Shows app name, status, and navigation hints at bottom of screen

import React from 'react';
import { Text, Box } from 'ink';

const StatusBar: React.FC = () => {
  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text color="cyan">lace-ink</Text>
      <Text> | </Text>
      <Text color="green">Ready</Text>
      <Text> | </Text>
      <Text color="dim">↑/↓ to navigate</Text>
    </Box>
  );
};

export default StatusBar;