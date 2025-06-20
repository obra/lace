// ABOUTME: Specialized display component for TOOL_CALL events with expandable input parameters
// ABOUTME: Shows tool name, call ID, and collapsible JSON input for debugging

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolCallData } from '../../../../threads/types.js';
import { CollapsibleBox } from '../ui/CollapsibleBox.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';

interface ToolCallDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

export function ToolCallDisplay({ event, isStreaming }: ToolCallDisplayProps) {
  const toolCallData = event.data as ToolCallData;
  const { toolName, input, callId } = toolCallData;
  
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="yellow">🔧 </Text>
        <Text color="yellow" bold>{toolName}</Text>
        <Text color="gray"> #{callId.slice(-6)}</Text>
        {isStreaming && <Text color="gray"> (streaming...)</Text>}
      </Box>
      
      <CollapsibleBox 
        label="Input Parameters"
        defaultExpanded={false}
        maxHeight={10}
        borderColor="yellow"
      >
        <CodeDisplay code={JSON.stringify(input)} language="json" />
      </CollapsibleBox>
    </Box>
  );
}