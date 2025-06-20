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

function shouldUseCompact(input: Record<string, unknown>): boolean {
  // Use compact for simple inputs with few fields
  const keys = Object.keys(input);
  if (keys.length <= 2) {
    // Check if all values are simple (strings, numbers, booleans)
    return keys.every(key => {
      const value = input[key];
      return typeof value === 'string' || 
             typeof value === 'number' || 
             typeof value === 'boolean';
    });
  }
  return false;
}

function shouldUseCompactForOutput(output: string): boolean {
  try {
    const parsed = JSON.parse(output);
    // Use compact for simple objects with few fields
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      return keys.length <= 3 && keys.every(key => {
        const value = parsed[key];
        return typeof value === 'string' || 
               typeof value === 'number' || 
               typeof value === 'boolean';
      });
    }
  } catch {
    // Not valid JSON
  }
  return false;
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
        borderColor="yellow"
      >
        <CodeDisplay 
          code={JSON.stringify(input)} 
          language="json" 
          compact={shouldUseCompact(input)}
        />
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
                <CodeDisplay 
                  code={output} 
                  language="json" 
                  compact={shouldUseCompactForOutput(output)}
                />
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