// ABOUTME: InputBar component for user input at bottom of screen
// ABOUTME: Shows prompt and placeholder text, positioned at very bottom

import React from 'react';
import { Text, Box } from 'ink';

const InputBar: React.FC = () => {
  return (
    <Box>
      <Text color="cyan">{'> '}</Text>
      <Text color="dim">Type your message...</Text>
    </Box>
  );
};

export default InputBar;