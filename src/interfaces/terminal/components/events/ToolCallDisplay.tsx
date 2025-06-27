// ABOUTME: Specialized display component for TOOL_CALL events with expandable input parameters
// ABOUTME: Shows tool name, call ID, and collapsible JSON input for debugging

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent, ToolCallData } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { CodeDisplay } from '../ui/CodeDisplay.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';
import { useTimelineExpansionToggle } from './hooks/useTimelineExpansionToggle.js';

interface ToolCallDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export function ToolCallDisplay({ event, isStreaming, isFocused, isSelected, onToggle }: ToolCallDisplayProps) {
  const toolCallData = event.data as ToolCallData;
  const { toolName, input, callId } = toolCallData;
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Handle expansion toggle events
  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
    onToggle?.();
  };
  
  // Listen for expansion toggle events when selected
  useTimelineExpansionToggle(isSelected || false, toggleExpansion);
  
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
      onExpandedChange={(expanded) => {
        setIsExpanded(expanded);
        onToggle?.();
      }}
      maxHeight={10}
      borderColor={UI_COLORS.TOOL}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      <CodeDisplay code={JSON.stringify(input)} language="json" />
    </TimelineEntryCollapsibleBox>
  );
}