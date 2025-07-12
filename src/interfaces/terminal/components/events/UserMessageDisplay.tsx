// ABOUTME: Display component for USER_MESSAGE events with collapsible formatting
// ABOUTME: Shows user input in expandable boxes with auto-collapse for long messages

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '~/threads/types';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

interface UserMessageDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  // Selection and expansion state comes from context
}

// Text processing utilities
function trimEmptyLines(text: string): string {
  const lines = text.split('\n');

  // Remove leading empty lines
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  // Reduce multiple consecutive empty lines to single empty line
  const result: string[] = [];
  let lastWasEmpty = false;

  for (const line of lines) {
    const isEmpty = line.trim() === '';

    if (isEmpty) {
      if (!lastWasEmpty) {
        result.push(''); // Keep empty line but strip spaces
      }
      lastWasEmpty = true;
    } else {
      result.push(line.trim()); // Strip leading/trailing spaces from content lines
      lastWasEmpty = false;
    }
  }

  return result.join('\n');
}

function truncateToLines(
  text: string,
  maxLines: number
): { content: string; wasTruncated: boolean } {
  const lines = text.split('\n');

  if (lines.length <= maxLines) {
    return { content: text, wasTruncated: false };
  }

  return {
    content: lines.slice(0, maxLines).join('\n'),
    wasTruncated: true,
  };
}

export function UserMessageDisplay({
  event,
  isStreaming,
  isFocused = true, // Default to true since we don't have focus logic for user messages yet
}: UserMessageDisplayProps) {
  const rawMessage = event.data as string;
  const trimmedMessage = trimEmptyLines(rawMessage);
  const lines = trimmedMessage.split('\n');
  const shouldAutoCollapse = lines.length > 8;

  // Get expansion state from context
  const { isExpanded, onExpand } = useTimelineItem();

  // For short messages, auto-expand on mount
  React.useEffect(() => {
    if (!shouldAutoCollapse && !isExpanded) {
      onExpand();
    }
  }, [shouldAutoCollapse, isExpanded, onExpand]);

  // For collapsed state (> 8 lines), show truncated with ellipsis
  const { content: displayContent, wasTruncated } = truncateToLines(trimmedMessage, 8);

  // Create the message display
  const messageDisplay = (
    <Box flexDirection="column">
      <Text wrap="wrap" dimColor={!isFocused}>
        "{isExpanded ? trimmedMessage : displayContent}"
      </Text>
      {!isExpanded && wasTruncated && <Text color="gray">...</Text>}
      {isStreaming && <Text color="gray"> (typing...)</Text>}
    </Box>
  );

  return (
    <TimelineEntry
      label={messageDisplay}
      summary={null}
      status="none"
      messageType="user"
      isExpandable={shouldAutoCollapse}
    >
      {null}
    </TimelineEntry>
  );
}
