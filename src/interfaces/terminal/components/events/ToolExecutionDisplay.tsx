// ABOUTME: Unified display component for TOOL_CALL and TOOL_RESULT events with navigation
// ABOUTME: Shows tool execution with compact output, input/output truncation, and expansion controls

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../../../threads/types.js';
import { CompactOutput } from '../ui/CompactOutput.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

interface ToolExecutionDisplayProps {
  callEvent: ThreadEvent;
  resultEvent?: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isExpanded?: boolean;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;
  
  const trimmed = output.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}


export function ToolExecutionDisplay({ callEvent, resultEvent, isStreaming, isFocused, isExpanded = false }: ToolExecutionDisplayProps) {
  const toolCallData = callEvent.data as ToolCallData;
  const { toolName, input } = toolCallData;
  
  const toolResultData = resultEvent?.data as ToolResultData | undefined;
  const success = toolResultData?.success ?? true;
  const output = toolResultData?.output;
  const error = toolResultData?.error;
  
  // Determine tool command for compact header
  const getToolCommand = (toolName: string, input: Record<string, unknown>): string => {
    switch (toolName) {
      case 'bash':
        return input.command as string || '';
      case 'file-read':
        return input.file_path as string || '';
      case 'file-write':
        return input.file_path as string || '';
      case 'file-edit':
        return input.file_path as string || '';
      case 'ripgrep-search':
        return `"${input.pattern}"` || '';
      case 'delegate':
        return `"${input.task}"` || '';
      default:
        // For other tools, show first parameter value
        const firstValue = Object.values(input)[0];
        if (typeof firstValue === 'string' && firstValue.length < 50) {
          return firstValue;
        }
        return '';
    }
  };
  
  const toolCommand = getToolCommand(toolName, input);
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : (resultEvent ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING);
  const expansionIcon = isExpanded ? UI_SYMBOLS.ARROW_DOWN : UI_SYMBOLS.ARROW_RIGHT;
  
  return (
    <Box flexDirection="column" marginY={1}>
      {/* Compact tool header */}
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>{toolName}</Text>
        {toolCommand && (
          <React.Fragment>
            <Text color="gray"> </Text>
            <Text color="white">{toolCommand}</Text>
          </React.Fragment>
        )}
        <Text color="gray"> </Text>
        <Text color={success ? UI_COLORS.SUCCESS : (resultEvent ? UI_COLORS.ERROR : UI_COLORS.PENDING)}>{statusIcon}</Text>
        {isStreaming && <Text color="gray"> (running...)</Text>}
        {isFocused && resultEvent && (
          <Text color="gray"> {expansionIcon}</Text>
        )}
      </Box>
      
      {/* Expanded content when requested */}
      {isExpanded && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {/* Input parameters */}
          <Box flexDirection="column" marginBottom={1}>
            <Text color="yellow">Input:</Text>
            <Box marginLeft={2}>
              <CodeDisplay 
                code={JSON.stringify(input, null, 2)} 
                language="json" 
                compact={false}
              />
            </Box>
          </Box>
          
          {/* Output */}
          {resultEvent && (
            <Box flexDirection="column">
              <Text color={success ? 'green' : 'red'}>
                {success ? 'Output:' : 'Error:'}
              </Text>
              <Box marginLeft={2}>
                {success ? (
                  <CompactOutput 
                    output={output || 'No output'} 
                    language={isJsonOutput(output || '') ? 'json' : 'text'}
                    maxLines={50} // Large number for expanded view
                    canExpand={false} // Already expanded
                  />
                ) : (
                  <Text color="red">{error || 'Unknown error'}</Text>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}
      
      {/* Compact output preview when not expanded */}
      {!isExpanded && resultEvent && success && output && (
        <Box marginLeft={2} marginTop={1}>
          <CompactOutput 
            output={output} 
            language={isJsonOutput(output) ? 'json' : 'text'}
            maxLines={3}
            canExpand={false} // Expansion handled by component itself
          />
        </Box>
      )}
    </Box>
  );
}
