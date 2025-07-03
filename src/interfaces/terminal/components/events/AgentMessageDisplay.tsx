// ABOUTME: Display component for AGENT_MESSAGE events with internal thinking handling
// ABOUTME: Shows agent responses with expansion support for thinking blocks

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { MarkdownDisplay } from '../ui/MarkdownDisplay.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import {
  parseThinkingBlocks,
  createSummaryContent,
  formatThinkingForDisplay,
} from './utils/thinking-parser.js';
import { useTimelineItemExpansion } from './hooks/useTimelineExpansionToggle.js';

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

  // Use shared expansion state management
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected || false, (expanded) => onToggle?.());

  // Create handler that works with TimelineEntryCollapsibleBox interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  // If no thinking blocks and not streaming, render directly without collapsible wrapper
  if (!parsed.hasThinking && !isStreaming) {
    return (
      <Box flexDirection="column">
        <MarkdownDisplay content={message} showIcon={true} dimmed={!isFocused} />
      </Box>
    );
  }

  // Prepare content based on expansion state and streaming status
  const displayContent = isExpanded || isStreaming
    ? formatThinkingForDisplay(message)
    : createSummaryContent(message);

  // If streaming but no thinking blocks yet, show direct content with thinking indicator
  if (isStreaming && !parsed.hasThinking) {
    return (
      <Box flexDirection="column">
        <MarkdownDisplay content={message} showIcon={true} dimmed={!isFocused} />
        <Box marginTop={1}>
          <Text color="gray"> (thinking...)</Text>
        </Box>
      </Box>
    );
  }

  return (
    <TimelineEntryCollapsibleBox
      label="Agent Response"
      summary={
        isExpanded ? null : (
          <MarkdownDisplay content={displayContent} showIcon={true} dimmed={!isFocused} />
        )
      }
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status={isStreaming ? 'pending' : 'success'}
      isExpandable={true}
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
