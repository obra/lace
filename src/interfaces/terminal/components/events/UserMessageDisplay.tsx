// ABOUTME: Display component for USER_MESSAGE events with consistent styling
// ABOUTME: Shows user input with clear visual distinction from agent messages

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';

interface UserMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  focusedLine?: number;
  itemStartLine?: number;
}

export function UserMessageDisplay({ event, isStreaming, isFocused }: UserMessageDisplayProps) {
  const message = event.data as string;
  
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Text color="dim">&gt; </Text>
        <Text wrap="wrap" dimColor={!isFocused}>{message.trim()}</Text>
        {isStreaming && <Text color="gray"> (typing...)</Text>}
      </Box>
    </Box>
  );
}