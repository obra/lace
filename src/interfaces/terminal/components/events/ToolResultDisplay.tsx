// ABOUTME: Specialized display component for TOOL_RESULT events with success/error styling
// ABOUTME: Shows matching call ID, result status, and output with appropriate formatting

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { ToolResult } from '../../../../tools/types.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';
import { UI_SYMBOLS } from '../../theme.js';

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
  const toolResultData = event.data as ToolResult;
  const callId = toolResultData.id || 'unknown';
  const success = !toolResultData.isError;
  const color = success ? 'green' : 'red';
  const icon = success ? UI_SYMBOLS.SUCCESS : UI_SYMBOLS.ERROR;
  
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={color}>{icon} Tool Result </Text>
        <Text color="gray">#{callId.slice(-6)}</Text>
        {isStreaming && <Text color="gray"> (streaming...)</Text>}
      </Box>
      
      <Box marginLeft={2} flexDirection="column">
        {toolResultData.content.map((block, index) => (
          <Box key={index} flexDirection="column" marginBottom={index < toolResultData.content.length - 1 ? 1 : 0}>
            {block.type === 'text' && block.text && (
              success ? (
                isJsonOutput(block.text) ? (
                  <CodeDisplay code={block.text} language="json" />
                ) : (
                  <Text wrap="wrap" color={toolResultData.isError ? 'red' : undefined}>
                    {block.text}
                  </Text>
                )
              ) : (
                <Text color="red">{block.text}</Text>
              )
            )}
            {block.type === 'image' && (
              <Text color="gray">[Image: {block.data ? 'base64 data' : block.uri}]</Text>
            )}
            {block.type === 'resource' && (
              <Text color="gray">[Resource: {block.uri}]</Text>
            )}
          </Box>
        ))}
        {toolResultData.content.length === 0 && (
          <Text color="gray">[No content]</Text>
        )}
      </Box>
    </Box>
  );
}