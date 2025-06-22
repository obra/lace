// ABOUTME: Unified display component for TOOL_CALL and TOOL_RESULT events with navigation
// ABOUTME: Shows tool execution with compact output, input/output truncation, and expansion controls

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../../../threads/types.js';
import { CompactOutput } from '../ui/CompactOutput.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';

interface ToolExecutionDisplayProps {
  callEvent: ThreadEvent;
  resultEvent?: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;
  
  const trimmed = output.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}


export function ToolExecutionDisplay({ callEvent, resultEvent, isStreaming, isFocused }: ToolExecutionDisplayProps) {
  const toolCallData = callEvent.data as ToolCallData;
  const { toolName, input } = toolCallData;
  
  const toolResultData = resultEvent?.data as ToolResultData | undefined;
  const success = toolResultData?.success ?? true;
  const output = toolResultData?.output;
  const error = toolResultData?.error;
  
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Handle left/right arrow expansion when focused
  // Note: We rely on the parent TimelineDisplay's focus management
  // Only respond to left/right when this specific item is timeline-focused
  useInput(useCallback((inputKey, key) => {
    if (!isFocused) return;
    
    if (key.rightArrow) {
      setIsExpanded(true);
    } else if (key.leftArrow) {
      setIsExpanded(false);
    }
  }, [isFocused]));
  
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
  const statusIcon = success ? '✅' : (resultEvent ? '❌' : '⏳');
  const expansionIcon = isExpanded ? '↓' : '→';
  
  return (
    <Box flexDirection="column" marginY={1}>
      {/* Compact tool header */}
      <Box>
        <Text color="yellow">🔧 </Text>
        <Text color="yellow" bold>{toolName}</Text>
        {toolCommand && (
          <React.Fragment>
            <Text color="gray"> </Text>
            <Text color="white">{toolCommand}</Text>
          </React.Fragment>
        )}
        <Text color="gray"> </Text>
        <Text color={success ? 'green' : (resultEvent ? 'red' : 'yellow')}>{statusIcon}</Text>
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