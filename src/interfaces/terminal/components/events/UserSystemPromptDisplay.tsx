// ABOUTME: Display component for USER_SYSTEM_PROMPT events with collapsible interface  
// ABOUTME: Shows user instructions from LACE_DIR/instructions.md with expandable content

import React, { useState } from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';
import { useTimelineExpansionToggle } from './hooks/useTimelineExpansionToggle.js';

interface UserSystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

export function UserSystemPromptDisplay({ event, isStreaming, isFocused, isSelected, onToggle }: UserSystemPromptDisplayProps) {
  const userInstructions = event.data as string;
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
      key={`user-prompt-${event.id}`}
      label={`${UI_SYMBOLS.USER} User Instructions`}
      isExpanded={isExpanded}
      onExpandedChange={(expanded) => {
        setIsExpanded(expanded);
        onToggle?.();
      }}
      borderColor={UI_COLORS.USER}
      isSelected={isSelected}
      onToggle={onToggle}
    >
      <Text color="cyan" wrap="wrap">{userInstructions}</Text>
    </TimelineEntryCollapsibleBox>
  );
}