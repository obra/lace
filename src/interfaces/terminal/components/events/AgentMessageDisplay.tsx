// ABOUTME: Display component for AGENT_MESSAGE events with internal thinking handling
// ABOUTME: Shows agent responses with expansion support for thinking blocks

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { ThinkingAwareContent } from '../ui/ThinkingAwareContent.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { parseThinkingBlocks } from './utils/thinking-parser.js';
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

  // Check if content has any thinking blocks (completed or unclosed)
  const hasAnyThinking = parsed.hasThinking || message.includes('<think>');
  
  // If no thinking blocks at all, render directly without collapsible wrapper
  if (!hasAnyThinking) {
    return (
      <Box flexDirection="column">
        <ThinkingAwareContent 
          content={message} 
          showThinking={true} 
          showIcon={true} 
          dimmed={!isFocused} 
        />
        {isStreaming && (
          <Box marginTop={1}>
            <Text color="gray"> (thinking...)</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Determine whether to show thinking content or summary
  const showThinking = isExpanded || (isStreaming ?? false);

  return (
    <TimelineEntryCollapsibleBox
      label="Agent Response"
      summary={
        isExpanded ? null : (
          <ThinkingAwareContent 
            content={message} 
            showThinking={false} 
            showIcon={true} 
            dimmed={!isFocused} 
          />
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
        <ThinkingAwareContent 
          content={message} 
          showThinking={showThinking} 
          showIcon={true} 
          dimmed={!isFocused} 
        />
        {isStreaming && (
          <Box marginTop={1}>
            <Text color="gray"> (thinking...)</Text>
          </Box>
        )}
      </Box>
    </TimelineEntryCollapsibleBox>
  );
}
