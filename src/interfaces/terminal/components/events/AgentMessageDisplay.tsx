// ABOUTME: Display component for AGENT_MESSAGE events with internal thinking handling
// ABOUTME: Shows agent responses with expansion support for thinking blocks

import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { MarkdownDisplay } from '../ui/MarkdownDisplay.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import {
  parseThinkingBlocks,
  createSummaryContent,
  formatThinkingForDisplay,
} from './utils/thinking-parser.js';
import { useTimelineExpansionToggle } from './hooks/useTimelineExpansionToggle.js';

interface AgentMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export function AgentMessageDisplay({
  event,
  isStreaming,
  isFocused,
  isSelected,
  onToggle,
}: AgentMessageDisplayProps) {
  const message = event.data as string;

  // Parse thinking blocks from message content
  const parsed = useMemo(() => parseThinkingBlocks(message), [message]);

  // Manage own expansion state
  const [isExpanded, setIsExpanded] = useState(false);

  // Handle expansion toggle events
  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
    onToggle?.();
  };

  // Listen for expansion toggle events when selected
  useTimelineExpansionToggle(isSelected || false, toggleExpansion);

  // If no thinking blocks, render directly without collapsible wrapper
  if (!parsed.hasThinking) {
    return (
      <Box flexDirection="column">
        <MarkdownDisplay content={message} showIcon={true} dimmed={!isFocused} />
        {isStreaming && (
          <Box marginTop={1}>
            <Text color="gray"> (thinking...)</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Prepare content based on expansion state
  const displayContent = isExpanded
    ? formatThinkingForDisplay(message)
    : createSummaryContent(message);

  return (
    <TimelineEntryCollapsibleBox
      label="Agent Response"
      summary={
        isExpanded ? null : (
          <MarkdownDisplay content={displayContent} showIcon={true} dimmed={!isFocused} />
        )
      }
      isExpanded={isExpanded}
      onExpandedChange={(expanded) => {
        setIsExpanded(expanded);
        onToggle?.();
      }}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      <Box flexDirection="column">
        <MarkdownDisplay content={displayContent} showIcon={true} dimmed={!isFocused} />
        {isStreaming && (
          <Box marginTop={1}>
            <Text color="gray"> (thinking...)</Text>
          </Box>
        )}
      </Box>
    </TimelineEntryCollapsibleBox>
  );
}
