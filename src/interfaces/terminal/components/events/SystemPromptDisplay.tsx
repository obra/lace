// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';
import { useTimelineItemExpansion } from './hooks/useTimelineExpansionToggle.js';

interface SystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export function SystemPromptDisplay({
  event,
  isStreaming,
  isFocused,
  isSelected,
  onToggle,
}: SystemPromptDisplayProps) {
  const systemPrompt = event.data as string;

  // Use shared expansion state management
  const { isExpanded, handleExpandedChange } = useTimelineItemExpansion(isSelected || false, onToggle);

  return (
    <TimelineEntryCollapsibleBox
      key={`system-prompt-${event.id}`}
      label={`${UI_SYMBOLS.TOOL} System Prompt`}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      borderColor={UI_COLORS.INFO}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      <Text color="blue" wrap="wrap">
        {systemPrompt}
      </Text>
    </TimelineEntryCollapsibleBox>
  );
}
