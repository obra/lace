// ABOUTME: Display component for AGENT_MESSAGE events with markdown rendering
// ABOUTME: Shows agent responses with full markdown formatting and syntax highlighting

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { MarkdownDisplay } from '../ui/MarkdownDisplay.js';

interface AgentMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
}

export function AgentMessageDisplay({ event, isStreaming, isFocused }: AgentMessageDisplayProps) {
  const message = event.data as string;
  
  // Strip thinking blocks since they're displayed separately as thinking timeline items
  const messageWithoutThinking = message.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  
  // Don't render if message is empty after stripping thinking blocks
  if (!messageWithoutThinking) {
    return null;
  }
  
  return (
    <Box flexDirection="column">
      <MarkdownDisplay content={messageWithoutThinking} showIcon={true} />
      {isStreaming && (
        <Box marginTop={1}>
          <Text color="gray"> (thinking...)</Text>
        </Box>
      )}
    </Box>
  );
}