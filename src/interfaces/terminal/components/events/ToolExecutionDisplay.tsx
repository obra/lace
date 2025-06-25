// ABOUTME: Unified display component for TOOL_CALL and TOOL_RESULT events with navigation
// ABOUTME: Shows tool execution with compact output, input/output truncation, and expansion controls

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../../../threads/types.js';
import { CompactOutput } from '../ui/CompactOutput.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

interface ToolExecutionDisplayProps {
  callEvent: ThreadEvent;
  resultEvent?: ThreadEvent;
  isStreaming?: boolean;
  focusId?: string;
  onToggle?: () => void;
  onEscape?: () => void;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;
  
  const trimmed = output.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'));
}


export function ToolExecutionDisplay({ callEvent, resultEvent, isStreaming, focusId, onToggle, onEscape }: ToolExecutionDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
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
  
  // Create label and summary for the collapsible box
  const label = `${UI_SYMBOLS.TOOL} ${toolName}${toolCommand ? ` ${toolCommand}` : ''}`;
  
  const summary = (
    <Box>
      <Text color={success ? UI_COLORS.SUCCESS : (resultEvent ? UI_COLORS.ERROR : UI_COLORS.PENDING)}>{statusIcon}</Text>
      {isStreaming && <Text color="gray"> (running...)</Text>}
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
  
  return (
    <TimelineEntryCollapsibleBox
      label={label}
      summary={summary}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      expandedBorderColor={UI_COLORS.TOOL}
      focusId={focusId}
      onToggle={onToggle}
      onEscape={onEscape}
    >
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
    </TimelineEntryCollapsibleBox>
  );
}
