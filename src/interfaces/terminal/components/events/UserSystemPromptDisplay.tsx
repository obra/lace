// ABOUTME: Display component for USER_SYSTEM_PROMPT events with collapsible interface  
// ABOUTME: Shows user instructions from LACE_DIR/instructions.md with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';

interface UserSystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  onToggle?: () => void;
}

export function UserSystemPromptDisplay({ event, isStreaming, isFocused, onToggle }: UserSystemPromptDisplayProps) {
  const userInstructions = event.data as string;
  
  return (
    <TimelineEntryCollapsibleBox 
      key={`user-prompt-${event.id}`}
      label="📋 User Instructions" 
      defaultExpanded={false}
      borderColor="cyan"
      isFocused={isFocused}
      onToggle={onToggle}
    >
      <Text color="cyan" wrap="wrap">{userInstructions}</Text>
    </TimelineEntryCollapsibleBox>
  );
}