// ABOUTME: Display component for THINKING events with distinct visual styling
// ABOUTME: Shows agent thinking blocks extracted during streaming with proper formatting

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';

interface ThinkingDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
}

export function ThinkingDisplay({ event, isStreaming, isFocused }: ThinkingDisplayProps) {
  const thinkingContent = event.data as string;
  
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray">💭 </Text>
        <Text italic color="dim">{thinkingContent}</Text>
        {isStreaming && <Text color="gray"> (thinking...)</Text>}
      </Box>
    </Box>
  );
}