// ABOUTME: Display component for AGENT_MESSAGE events with internal thinking handling
// ABOUTME: Shows agent responses with expansion support for thinking blocks

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '~/threads/types';
import { ThinkingAwareContent } from '~/interfaces/terminal/components/ui/ThinkingAwareContent';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry';
import { parseThinkingBlocks } from '~/interfaces/terminal/components/events/utils/thinking-parser';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

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
  const { isExpanded } = useTimelineItem();

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
