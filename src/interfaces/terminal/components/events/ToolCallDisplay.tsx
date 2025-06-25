// ABOUTME: Specialized display component for TOOL_CALL events with expandable input parameters
// ABOUTME: Shows tool name, call ID, and collapsible JSON input for debugging

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolCallData } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

interface ToolCallDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

export function ToolCallDisplay({ event, isStreaming }: ToolCallDisplayProps) {
  const toolCallData = event.data as ToolCallData;
  const { toolName, input, callId } = toolCallData;
  const [isExpanded, setIsExpanded] = useState(false);
  
  const headerSummary = (
    <Box>
      <Text color={UI_COLORS.TOOL}>{UI_SYMBOLS.TOOL} </Text>
      <Text color={UI_COLORS.TOOL} bold>{toolName}</Text>
      <Text color="gray"> #{callId.slice(-6)}</Text>
      {isStreaming && <Text color="gray"> (streaming...)</Text>}
    </Box>
  );
  
  return (
    <TimelineEntryCollapsibleBox 
      label="Input Parameters"
      summary={headerSummary}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      maxHeight={10}
      expandedBorderColor={UI_COLORS.TOOL}
    >
      <CodeDisplay code={JSON.stringify(input)} language="json" />
    </TimelineEntryCollapsibleBox>
  );
}
