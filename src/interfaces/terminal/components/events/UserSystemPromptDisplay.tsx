// ABOUTME: Display component for USER_SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows user instructions from LACE_DIR/instructions.md with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntry } from '../ui/TimelineEntry.js';
import { UI_SYMBOLS } from '../../theme.js';
import { useTimelineItem } from './contexts/TimelineItemContext.js';

interface UserSystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  // Selection and expansion state comes from context
}

export function UserSystemPromptDisplay({
  event,
  isStreaming,
  isFocused,
}: UserSystemPromptDisplayProps) {
  const userInstructions = event.data as string;

  return (
    <TimelineEntry
      key={`user-prompt-${event.id}`}
      label={`${UI_SYMBOLS.USER} User Instructions`}
      status="none"
      isExpandable={true}
    >
      <Text color="cyan" wrap="wrap">
        {userInstructions}
      </Text>
    </TimelineEntry>
  );
}
