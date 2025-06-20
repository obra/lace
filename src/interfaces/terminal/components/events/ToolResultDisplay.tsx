// ABOUTME: Specialized display component for TOOL_RESULT events with success/error styling
// ABOUTME: Shows matching call ID, result status, and output with appropriate formatting

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolResultData } from '../../../../threads/types.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';

interface ToolResultDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;
  
  const trimmed = output.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

export function ToolResultDisplay({ event, isStreaming }: ToolResultDisplayProps) {
  const toolResultData = event.data as ToolResultData;
  const { callId, output, success, error } = toolResultData;
  const color = success ? 'green' : 'red';
  const icon = success ? '✅' : '❌';
  
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={color}>{icon} Tool Result </Text>
        <Text color="gray">#{callId.slice(-6)}</Text>
        {isStreaming && <Text color="gray"> (streaming...)</Text>}
      </Box>
      
      <Box marginLeft={2} flexDirection="column">
        {success ? (
          isJsonOutput(output) ? (
            <CodeDisplay code={output} language="json" />
          ) : (
            <Text wrap="wrap">{output}</Text>
          )
        ) : (
          <Text color="red">{error || 'Unknown error'}</Text>
        )}
      </Box>
    </Box>
  );
}