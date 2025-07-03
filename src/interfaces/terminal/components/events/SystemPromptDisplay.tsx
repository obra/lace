// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntry } from '../ui/TimelineEntry.js';
import { UI_SYMBOLS } from '../../theme.js';
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
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected || false, (expanded) => onToggle?.());

  // Create handler that works with TimelineEntry interface
  const handleExpandedChange = (expanded: boolean) => {
    if (expanded) {
      onExpand();
    } else {
      onCollapse();
    }
  };

  return (
    <TimelineEntry
      key={`system-prompt-${event.id}`}
      label={`${UI_SYMBOLS.TOOL} System Prompt`}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status="none"
      isExpandable={true}
    >
      <Text color="blue" wrap="wrap">
        {systemPrompt}
      </Text>
    </TimelineEntry>
  );
}
