// ABOUTME: StatusBar component for displaying basic status information
// ABOUTME: Shows app name, status, and navigation hints at bottom of screen

import React from 'react';
import { Text, Box } from 'ink';

interface StatusBarProps {
  isNavigationMode?: boolean;
  scrollPosition?: number;
  totalMessages?: number;
}

const StatusBar: React.FC<StatusBarProps> = ({ 
  isNavigationMode = false, 
  scrollPosition = 0, 
  totalMessages = 0 
}) => {
  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Text color="cyan">lace-ink</Text>
      <Text> | </Text>
      {isNavigationMode ? (
        <>
          <Text color="yellow">Nav: j/k</Text>
          <Text> | </Text>
          <Text color="dim">Line {scrollPosition + 1} of {totalMessages}</Text>
        </>
      ) : (
        <>
          <Text color="green">Ready</Text>
          <Text> | </Text>
          <Text color="dim">↑/↓ to navigate</Text>
        </>
      )}
    </Box>
  );
};

export default StatusBar;