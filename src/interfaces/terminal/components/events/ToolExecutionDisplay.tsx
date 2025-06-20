// ABOUTME: Unified display component for TOOL_CALL and TOOL_RESULT events together
// ABOUTME: Shows tool execution with input and output in one clean section

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../../../threads/types.js';
import { CollapsibleBox } from '../ui/CollapsibleBox.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';

interface ToolExecutionDisplayProps {
  callEvent: ThreadEvent;
  resultEvent?: ThreadEvent;
  isStreaming?: boolean;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;
  
  const trimmed = output.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

export function ToolExecutionDisplay({ callEvent, resultEvent, isStreaming }: ToolExecutionDisplayProps) {
  const toolCallData = callEvent.data as ToolCallData;
  const { toolName, input } = toolCallData;
  
  const toolResultData = resultEvent?.data as ToolResultData | undefined;
  const success = toolResultData?.success ?? true;
  const output = toolResultData?.output;
  const error = toolResultData?.error;
  
  return (
    <Box flexDirection="column" marginY={1}>
      {/* Tool header */}
      <Box>
        <Text color="yellow">🔧 </Text>
        <Text color="yellow" bold>{toolName}</Text>
        {isStreaming && <Text color="gray"> (running...)</Text>}
      </Box>
      
      {/* Input parameters */}
      <CollapsibleBox 
        label="Input"
        defaultExpanded={false}
        maxHeight={8}
        borderColor="yellow"
      >
        <CodeDisplay code={JSON.stringify(input)} language="json" />
      </CollapsibleBox>
      
      {/* Output (if we have a result) */}
      {resultEvent && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={success ? 'green' : 'red'}>
              {success ? '✅' : '❌'} Output
            </Text>
          </Box>
          <Box marginLeft={2} flexDirection="column">
            {success ? (
              output && isJsonOutput(output) ? (
                <CodeDisplay code={output} language="json" />
              ) : (
                <Text wrap="wrap">{output || 'No output'}</Text>
              )
            ) : (
              <Text color="red">{error || 'Unknown error'}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}