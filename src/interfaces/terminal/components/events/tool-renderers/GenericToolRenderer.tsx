// ABOUTME: Generic tool renderer component using TimelineEntryCollapsibleBox
// ABOUTME: Provides consistent expansion behavior for any tool execution with input/output display

import React, { forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { CompactOutput } from '../../ui/CompactOutput.js';
import { CodeDisplay } from '../../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { useTimelineItemExpansion } from '../hooks/useTimelineExpansionToggle.js';
import { TimelineItemRef } from '../../timeline-item-focus.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

interface GenericToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean; // Whether timeline cursor is on this item
  onToggle?: () => void;
}

// Default props for optional boolean values
const defaultProps = {
  isStreaming: false,
  isSelected: false,
} as const;

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;

  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

export const GenericToolRenderer = forwardRef<TimelineItemRef, GenericToolRendererProps>(({
  item,
  isStreaming = defaultProps.isStreaming,
  isSelected = defaultProps.isSelected,
  onToggle,
}, ref) => {
  // Generic tool renderer doesn't support focus entry (only specific tools like delegate do)
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      // No-op for generic tool renderer
    },
  }), []);
  // Use shared expansion management for consistent behavior
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected,
    (expanded) => onToggle?.()
  );

  // Create handler that works with TimelineEntryCollapsibleBox interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  const { call, result } = item;
  const { name: toolName, arguments: input } = call;

  const success = result ? !result.isError : true;
  const output = result?.content?.[0]?.text;
  const error = result?.isError ? output : undefined;

  // Generate tool command summary for compact header
  const getToolCommand = (toolName: string, input: Record<string, unknown>): string => {
    switch (toolName) {
      case 'bash':
        return (input.command as string) || '';
      case 'file-read':
      case 'file-write':
      case 'file-edit':
        return (input.file_path as string) || '';
      case 'ripgrep-search':
        return `"${input.pattern}"` || '';
      case 'delegate':
        return `"${input.task || input.prompt}"` || '';
      default:
        // For other tools, show first parameter value if it's short
        const firstValue = Object.values(input)[0];
        if (typeof firstValue === 'string' && firstValue.length < 50) {
          return firstValue;
        }
        return '';
    }
  };

  const toolCommand = getToolCommand(toolName, input);
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;

  // Format tool name nicely (bash, file-read, etc.)
  const formatToolName = (toolName: string | undefined): string => {
    return (toolName || 'unknown').replace(/_/g, '-');
  };

  // Truncate long inputs for summary (first 50 chars)
  const truncateInput = (input: Record<string, unknown>): string => {
    const inputStr = JSON.stringify(input);
    if (inputStr.length <= 50) return inputStr;
    return inputStr.substring(0, 47) + '...';
  };

  // Create compact summary for collapsed state
  const toolSummary = (
    <Box flexDirection="column">
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>
          {formatToolName(toolName)}
        </Text>
        {toolCommand && (
          <React.Fragment>
            <Text color="gray"> </Text>
            <Text color="white">{toolCommand}</Text>
          </React.Fragment>
        )}
        <Text color="gray"> </Text>
        <Text color={success ? UI_COLORS.SUCCESS : result ? UI_COLORS.ERROR : UI_COLORS.PENDING}>
          {statusIcon}
        </Text>
        {isStreaming && <Text color="gray"> (running...)</Text>}
        <Text color="magenta"> [GENERIC]</Text>
      </Box>

      {/* Compact output preview when collapsed */}
      {result && success && output && (
        <Box marginLeft={2} marginTop={1}>
          <CompactOutput
            output={output}
            language={isJsonOutput(output) ? 'json' : 'text'}
            maxLines={3}
            canExpand={false}
          />
        </Box>
      )}
    </Box>
  );

  // Create expanded content showing full input/output
  const expandedContent = (
    <Box flexDirection="column">
      {/* Input parameters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">Input:</Text>
        <Box marginLeft={2}>
          <CodeDisplay code={JSON.stringify(input, null, 2)} language="json" compact={false} />
        </Box>
      </Box>

      {/* Output */}
      {result && (
        <Box flexDirection="column">
          <Text color={success ? 'green' : 'red'}>{success ? 'Output:' : 'Error:'}</Text>
          <Box marginLeft={2}>
            {success ? (
              <CompactOutput
                output={output || 'No output'}
                language={isJsonOutput(output || '') ? 'json' : 'text'}
                maxLines={50}
                canExpand={false}
              />
            ) : (
              <Text color="red">{error || 'Unknown error'}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );


  return (
    <TimelineEntryCollapsibleBox
      label={`${formatToolName(toolName)}${toolCommand ? ` ${toolCommand}` : ''}`}
      summary={toolSummary}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      {expandedContent}
    </TimelineEntryCollapsibleBox>
  );
});
