// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntry } from '../ui/TimelineEntry.js';
import { UI_SYMBOLS } from '../../theme.js';
import { useTimelineItem } from './contexts/TimelineItemContext.js';

interface SystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  // Selection and expansion state comes from context
}

export function SystemPromptDisplay({
  event,
  isStreaming,
  isFocused,
}: SystemPromptDisplayProps) {
  const systemPrompt = event.data as string;

  // Get expansion state from context
  const { isExpanded } = useTimelineItem();

  return (
    <TimelineEntry
      key={`system-prompt-${event.id}`}
      label={`${UI_SYMBOLS.TOOL} System Prompt`}
      status="none"
      isExpandable={true}
    >
      <Text color="blue" wrap="wrap">
        {systemPrompt}
      </Text>
    </TimelineEntry>
  );
}
