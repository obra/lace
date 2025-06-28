// ABOUTME: Specialized tool renderer for delegate tool executions with delegation timeline display
// ABOUTME: Combines tool execution display with DelegationBox using TimelineEntryCollapsibleBox for consistency

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';
import { DelegationBox } from '../DelegationBox.js';
import { ToolCall, ToolResult } from '../../../../../tools/types.js';
import { CompactOutput } from '../../ui/CompactOutput.js';
import { CodeDisplay } from '../../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../../theme.js';
import { useTimelineExpansionToggle } from '../hooks/useTimelineExpansionToggle.js';

// Extract tool execution timeline item type
type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};

interface DelegateToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean; // Whether timeline cursor is on this item
  isFocused?: boolean; // Whether this item has keyboard focus
  onToggle?: () => void;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

function isJsonOutput(output: string): boolean {
  if (!output || typeof output !== 'string') return false;

  const trimmed = output.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

export function DelegateToolRenderer({
  item,
  isStreaming,
  isSelected,
  isFocused,
  onToggle,
  isExpanded: controlledExpanded,
  onExpandedChange,
}: DelegateToolRendererProps) {
  // Use controlled expansion if provided, otherwise manage internally
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;

  // Handle expansion toggle events
  const toggleExpansion = () => {
    const newExpanded = !isExpanded;
    if (onExpandedChange) {
      onExpandedChange(newExpanded);
    } else {
      setInternalExpanded(newExpanded);
    }
    onToggle?.();
  };

  // Listen for expansion toggle events when selected
  useTimelineExpansionToggle(isSelected || false, toggleExpansion);

  const { call, result } = item;
  const { arguments: input } = call;

  const success = result ? !result.isError : true;
  const output = result?.content?.[0]?.text;
  const error = result?.isError ? output : undefined;

  // Extract delegate task from input
  const delegateTask = ((input.task || input.prompt) as string) || 'Unknown task';
  const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;

  // Extract delegate thread ID from result metadata
  const extractDelegateThreadId = (item: ToolExecutionItem) => {
    const threadId = item.result?.metadata?.threadId;
    return threadId && typeof threadId === 'string' ? threadId : null;
  };

  const delegateThreadId = extractDelegateThreadId(item);

  // Create compact summary for collapsed state
  const delegateSummary = (
    <Box flexDirection="column">
      <Box>
        <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
        <Text color={UI_COLORS.TOOL} bold>
          delegate
        </Text>
        <Text color="gray"> </Text>
        <Text color="white">"{delegateTask}"</Text>
        <Text color="gray"> </Text>
        <Text color={success ? UI_COLORS.SUCCESS : result ? UI_COLORS.ERROR : UI_COLORS.PENDING}>
          {statusIcon}
        </Text>
        {isStreaming && <Text color="gray"> (running...)</Text>}
        <Text color="cyan"> [DELEGATE]</Text>
      </Box>

      {/* Show delegation status when collapsed */}
      {delegateThreadId && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={UI_COLORS.DELEGATE}>{UI_SYMBOLS.DELEGATE} </Text>
          <Text color="gray">Thread: {delegateThreadId}</Text>
          {result && success && <Text color={UI_COLORS.SUCCESS}> - Delegation active</Text>}
        </Box>
      )}

      {/* Compact output preview when collapsed and successful */}
      {result && success && output && !delegateThreadId && (
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

  // Create expanded content showing full input/output + delegation
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
        <Box flexDirection="column" marginBottom={delegateThreadId ? 1 : 0}>
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

      {/* Delegation details when expanded */}
      {delegateThreadId && (
        <Box flexDirection="column">
          <Text color="yellow">Delegation:</Text>
          <Box marginLeft={2}>
            <DelegationBox toolCall={item} parentFocusId="timeline" onToggle={onToggle} />
          </Box>
        </Box>
      )}
    </Box>
  );

  const handleExpandedChange = (expanded: boolean) => {
    if (onExpandedChange) {
      onExpandedChange(expanded);
    } else {
      setInternalExpanded(expanded);
    }
    onToggle?.();
  };

  return (
    <TimelineEntryCollapsibleBox
      label={`delegate "${delegateTask}"`}
      summary={delegateSummary}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      {expandedContent}
    </TimelineEntryCollapsibleBox>
  );
}
