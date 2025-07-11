// ABOUTME: Specialized display component for TOOL_CALL events with expandable input parameters
// ABOUTME: Shows tool name, call ID, and collapsible JSON input for debugging

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '~/threads/types.js';
import { ToolCall } from '~/tools/types.js';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry.js';
import { CodeDisplay } from '~/interfaces/terminal/components/ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '~/interfaces/terminal/theme.js';
import { useTimelineItemExpansion } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle.js';

interface ToolCallDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export function ToolCallDisplay({
  event,
  isStreaming,
  isFocused: _isFocused,
  isSelected,
  onToggle,
}: ToolCallDisplayProps) {
  const toolCallData = event.data as ToolCall;
  const { name: toolName, arguments: input, id: callId } = toolCallData;

  // Use shared expansion state management
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
    isSelected || false,
    (_expanded) => onToggle?.()
  );

  // Create handler that works with TimelineEntry interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  const headerSummary = (
    <Box>
      <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
      <Text color={UI_COLORS.TOOL} bold>
        {toolName}
      </Text>
      <Text color="gray"> #{callId.slice(-6)}</Text>
      {isStreaming && <Text color="gray"> (streaming...)</Text>}
    </Box>
  );

  return (
    <TimelineEntry
      label="Input Parameters"
      summary={headerSummary}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status={isStreaming ? 'pending' : 'none'}
      isExpandable={true}
    >
      <CodeDisplay code={JSON.stringify(input)} language="json" />
    </TimelineEntry>
  );
}
