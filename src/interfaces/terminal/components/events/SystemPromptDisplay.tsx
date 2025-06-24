// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';

interface SystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  onToggle?: () => void;
}

export function SystemPromptDisplay({ event, isStreaming, isFocused, onToggle }: SystemPromptDisplayProps) {
  const systemPrompt = event.data as string;
  
  return (
    <TimelineEntryCollapsibleBox 
      key={`system-prompt-${event.id}`}
      label="🔧 System Prompt" 
      defaultExpanded={false}
      borderColor="blue"
      isFocused={isFocused}
      onToggle={onToggle}
    >
      <Text color="blue" wrap="wrap">{systemPrompt}</Text>
    </TimelineEntryCollapsibleBox>
  );
}