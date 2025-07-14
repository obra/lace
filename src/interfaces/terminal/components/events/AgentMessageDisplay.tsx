// ABOUTME: Display component for AGENT_MESSAGE events with internal thinking handling
// ABOUTME: Shows agent responses with expansion support for thinking blocks

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { ThinkingAwareContent } from '../ui/ThinkingAwareContent.js';
import { TimelineEntry } from '../ui/TimelineEntry.js';
import { parseThinkingBlocks } from './utils/thinking-parser.js';
import { useTimelineItem } from './contexts/TimelineItemContext.js';
import { UI_SYMBOLS } from '../../theme.js';

interface AgentMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  // Selection and expansion state comes from context
}

export function AgentMessageDisplay({ event, isStreaming, isFocused }: AgentMessageDisplayProps) {
  const message = event.data as string;

  // Parse thinking blocks from message content
  const parsed = useMemo(() => parseThinkingBlocks(message), [message]);

  // Get expansion state from context
  const { isExpanded, isSelected } = useTimelineItem();

  // Force expand when streaming to show the (thinking...) indicator
  const effectiveIsExpanded = isExpanded || (isStreaming ?? false);

  // Check if content has any thinking blocks (completed or unclosed)
  const hasAnyThinking = parsed.hasThinking || message.includes('<think>');

  // Determine whether to show thinking content or summary
  const showThinking = effectiveIsExpanded;

  return (
    <TimelineEntry
      summary={
        effectiveIsExpanded ? null : (
          <ThinkingAwareContent
            content={message}
            showThinking={false}
            showIcon={true}
            dimmed={!isFocused}
          />
        )
      }
      isExpanded={effectiveIsExpanded}
      status={isStreaming ? 'pending' : 'success'}
      messageType="agent"
      isExpandable={hasAnyThinking && !isStreaming}
      isStreaming={isStreaming}
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
    </TimelineEntry>
  );
}
