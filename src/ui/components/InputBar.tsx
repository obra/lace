// ABOUTME: InputBar component for user input at bottom of screen
// ABOUTME: Shows prompt and placeholder text, positioned at very bottom

import React from 'react';
import { Text, Box } from 'ink';

interface InputBarProps {
  isNavigationMode?: boolean;
  inputText?: string;
  showCursor?: boolean;
}

const InputBar: React.FC<InputBarProps> = ({ 
  isNavigationMode = false, 
  inputText = '',
  showCursor = false 
}) => {
  return (
    <Box>
      <Text color="cyan">{'> '}</Text>
      {isNavigationMode ? (
        <Text color="yellow">Navigation mode - Press Escape to exit</Text>
      ) : (
        <>
          {inputText ? (
            <Text>{inputText}</Text>
          ) : (
            <Text color="dim">Type your message...</Text>
          )}
          {showCursor && !isNavigationMode && (
            <Text>|</Text>
          )}
        </>
      )}
    </Box>
  );
};

export default InputBar;