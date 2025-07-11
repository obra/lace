// ABOUTME: Unified display component for TOOL_CALL and TOOL_RESULT events with navigation
// ABOUTME: Shows tool execution with compact output, input/output truncation, and expansion controls

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry.js';
import { ThreadEvent } from '~/threads/types.js';
import { ToolCall, ToolResult } from '~/tools/types.js';
import { CompactOutput } from '~/interfaces/terminal/components/ui/CompactOutput.js';
import { CodeDisplay } from '~/interfaces/terminal/components/ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '~/interfaces/terminal/theme.js';
import { useTimelineItemExpansion } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle.js';
import { type TimelineStatus } from '~/interfaces/terminal/components/ui/TimelineEntry.js';

interface ToolExecutionDisplayProps {
  callEvent: ThreadEvent;
  resultEvent?: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;

  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

export function ToolExecutionDisplay({
  callEvent,
  resultEvent,
  isStreaming,
  isFocused,
  isSelected,
  onToggle,
}: ToolExecutionDisplayProps) {
  const toolCallData = callEvent.data as ToolCall;

  // Use shared expansion state management
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected || false,
    (expanded) => onToggle?.()
  );

  // Create handler that works with TimelineEntry interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };
  const { name: toolName, arguments: input } = toolCallData;

  const toolResultData = resultEvent?.data as ToolResult | undefined;
  const success = toolResultData ? !toolResultData.isError : true;
  // Get first text block for compact display
  const firstTextBlock = toolResultData?.content.find(
    (block) => block.type === 'text' && block.text
  );
  const output = firstTextBlock?.text;
  const error = toolResultData?.isError ? output : undefined;
  const markerStatus: TimelineStatus = isStreaming
    ? 'pending'
    : success
      ? 'success'
      : toolResultData
        ? 'error'
        : 'none';

  // Determine tool command for compact header
  const getToolCommand = (toolName: string, input: Record<string, unknown>): string => {
    switch (toolName) {
      case 'bash':
        return (input.command as string) || '';
      case 'file-read':
        return (input.file_path as string) || '';
      case 'file-write':
        return (input.file_path as string) || '';
      case 'file-edit':
        return (input.file_path as string) || '';
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
  const statusIcon = success
    ? UI_SYMBOLS.SUCCESS
    : resultEvent
      ? UI_SYMBOLS.ERROR
      : UI_SYMBOLS.PENDING;

  // Create compact summary for collapsed state
  const toolSummary = (
    <Box flexDirection="column">
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>
          {toolName}
        </Text>
        {toolCommand && (
          <React.Fragment>
            <Text color="gray"> </Text>
            <Text color="white">{toolCommand}</Text>
          </React.Fragment>
        )}
        <Text color="gray"> </Text>
        <Text
          color={success ? UI_COLORS.SUCCESS : resultEvent ? UI_COLORS.ERROR : UI_COLORS.PENDING}
        >
          {statusIcon}
        </Text>
        {isStreaming && <Text color="gray"> (running...)</Text>}
      </Box>

      {/* Compact output preview when collapsed */}
      {resultEvent && success && output && (
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

  // Create expanded content
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
      {resultEvent && (
        <Box flexDirection="column">
          <Text color={success ? 'green' : 'red'}>{success ? 'Output:' : 'Error:'}</Text>
          <Box marginLeft={2}>
            {success ? (
              toolResultData?.content ? (
                toolResultData.content.map((block, idx) => (
                  <Box key={idx} flexDirection="column">
                    {block.type === 'text' && block.text && (
                      <CompactOutput
                        output={block.text}
                        language={isJsonOutput(block.text) ? 'json' : 'text'}
                        maxLines={50}
                        canExpand={false}
                      />
                    )}
                    {block.type === 'image' && (
                      <Text color="gray">[Image: {block.data ? 'base64 data' : 'no data'}]</Text>
                    )}
                    {block.type === 'resource' && <Text color="gray">[Resource: {block.uri}]</Text>}
                  </Box>
                ))
              ) : (
                <Text color="gray">No output</Text>
              )
            ) : (
              <Text color="red">{error || 'Unknown error'}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );

  return (
    <TimelineEntry
      label={`${toolName}${toolCommand ? ` ${toolCommand}` : ''}`}
      summary={toolSummary}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status={markerStatus}
      isExpandable={true}
    >
      {expandedContent}
    </TimelineEntry>
  );
}
