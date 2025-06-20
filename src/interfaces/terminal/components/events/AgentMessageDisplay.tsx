// ABOUTME: Display component for AGENT_MESSAGE events with streaming support
// ABOUTME: Shows agent responses with distinct styling and handles markdown rendering

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';

interface AgentMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

export function AgentMessageDisplay({ event, isStreaming }: AgentMessageDisplayProps) {
  const message = event.data as string;
  
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="white" bold>🤖 Assistant</Text>
        <Text color="dim" dimColor>
          {' '}({event.timestamp.toLocaleTimeString()})
        </Text>
        {isStreaming && <Text color="gray"> (thinking...)</Text>}
      </Box>
      <Box paddingLeft={2}>
        <Text color="white" wrap="wrap">{message}</Text>
      </Box>
    </Box>
  );
}