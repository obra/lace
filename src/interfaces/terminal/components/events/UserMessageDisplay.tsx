// ABOUTME: Display component for USER_MESSAGE events with consistent styling
// ABOUTME: Shows user input with clear visual distinction from agent messages

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';

interface UserMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

export function UserMessageDisplay({ event, isStreaming }: UserMessageDisplayProps) {
  const message = event.data as string;
  
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="blue" bold>👤 You</Text>
        {isStreaming && <Text color="gray"> (typing...)</Text>}
      </Box>
      <Box marginLeft={2}>
        <Text wrap="wrap">{message}</Text>
      </Box>
    </Box>
  );
}