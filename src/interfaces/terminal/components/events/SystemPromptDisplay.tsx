// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React, { useState } from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';
import { useTimelineExpansionToggle } from './hooks/useTimelineExpansionToggle.js';

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
  const [isExpanded, setIsExpanded] = useState(false);

  // Handle expansion toggle events
  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
    onToggle?.();
  };

  // Listen for expansion toggle events when selected
  useTimelineExpansionToggle(isSelected || false, toggleExpansion);

  return (
    <TimelineEntryCollapsibleBox
      key={`system-prompt-${event.id}`}
      label={`${UI_SYMBOLS.TOOL} System Prompt`}
      isExpanded={isExpanded}
      onExpandedChange={(expanded) => {
        setIsExpanded(expanded);
        onToggle?.();
      }}
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
