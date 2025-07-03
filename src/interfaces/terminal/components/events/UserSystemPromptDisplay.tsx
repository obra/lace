// ABOUTME: Display component for USER_SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows user instructions from LACE_DIR/instructions.md with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntry } from '../ui/TimelineEntry.js';
import { UI_SYMBOLS } from '../../theme.js';
import { useTimelineItemExpansion } from './hooks/useTimelineExpansionToggle.js';

interface UserSystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export function UserSystemPromptDisplay({
  event,
  isStreaming,
  isFocused,
  isSelected,
  onToggle,
}: UserSystemPromptDisplayProps) {
  const userInstructions = event.data as string;

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
      key={`user-prompt-${event.id}`}
      label={`${UI_SYMBOLS.USER} User Instructions`}
      isExpanded={isExpanded}
      onExpandedChange={handleExpandedChange}
      isSelected={isSelected}
      onToggle={onToggle}
      status="none"
      isExpandable={true}
    >
      <Text color="cyan" wrap="wrap">
        {userInstructions}
      </Text>
    </TimelineEntry>
  );
}
