// ABOUTME: InputBar component for user input at bottom of screen
// ABOUTME: Shows prompt and placeholder text, positioned at very bottom

import React from 'react';
import { Text, Box } from 'ink';

interface InputBarProps {
  isNavigationMode?: boolean;
}

const InputBar: React.FC<InputBarProps> = ({ isNavigationMode = false }) => {
  return (
    <Box>
      <Text color="cyan">{'> '}</Text>
      {isNavigationMode ? (
        <Text color="yellow">Navigation mode - Press Escape to exit</Text>
      ) : (
        <Text color="dim">Type your message...</Text>
      )}
    </Box>
  );
};

export default InputBar;