// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '~/threads/types';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry';
import { UI_SYMBOLS } from '~/interfaces/terminal/theme';
import { useTimelineItem } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

interface SystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  // Selection and expansion state comes from context
}

export function SystemPromptDisplay({
  event,
  isStreaming: _isStreaming,
  isFocused: _isFocused,
}: SystemPromptDisplayProps) {
  const systemPrompt = event.data as string;

  // Get expansion state from context
  useTimelineItem();

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
