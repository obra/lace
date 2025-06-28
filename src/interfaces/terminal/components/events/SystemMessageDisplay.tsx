// ABOUTME: Display component for LOCAL_SYSTEM_MESSAGE events with muted styling
// ABOUTME: Shows system notifications like compaction messages with appropriate visual treatment

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { UI_SYMBOLS } from '../../theme.js';

interface SystemMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
}

export function SystemMessageDisplay({ event, isStreaming, isFocused }: SystemMessageDisplayProps) {
  const message = event.data as string;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="gray" italic>
          {UI_SYMBOLS.INFO} System
        </Text>
        {isStreaming && <Text color="gray"> (processing...)</Text>}
      </Box>
      <Box marginLeft={2}>
        <Text color="gray" wrap="wrap">
          {message}
        </Text>
      </Box>
    </Box>
  );
}
