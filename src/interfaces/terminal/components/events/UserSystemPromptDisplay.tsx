// ABOUTME: Display component for USER_SYSTEM_PROMPT events with collapsible interface  
// ABOUTME: Shows user instructions from LACE_DIR/instructions.md with expandable content

import React, { useState } from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

interface UserSystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  focusId?: string;
  onToggle?: () => void;
  onEscape?: () => void;
}

export function UserSystemPromptDisplay({ event, isStreaming, focusId, onToggle, onEscape }: UserSystemPromptDisplayProps) {
  const userInstructions = event.data as string;
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <TimelineEntryCollapsibleBox 
      key={`user-prompt-${event.id}`}
      label={`${UI_SYMBOLS.USER} User Instructions`}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      expandedBorderColor={UI_COLORS.USER}
      focusId={focusId}
      onToggle={onToggle}
      onEscape={onEscape}
    >
      <Text color="cyan" wrap="wrap">{userInstructions}</Text>
    </TimelineEntryCollapsibleBox>
  );
}
