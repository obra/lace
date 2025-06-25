// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React, { useState } from 'react';
import { Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { TimelineEntryCollapsibleBox } from '../ui/TimelineEntryCollapsibleBox.js';
import { UI_SYMBOLS, UI_COLORS } from '../../theme.js';

interface SystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  focusId?: string;
  onToggle?: () => void;
  onEscape?: () => void;
}

export function SystemPromptDisplay({ event, isStreaming, focusId, onToggle, onEscape }: SystemPromptDisplayProps) {
  const systemPrompt = event.data as string;
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <TimelineEntryCollapsibleBox 
      key={`system-prompt-${event.id}`}
      label={`${UI_SYMBOLS.TOOL} System Prompt`}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      expandedBorderColor={UI_COLORS.INFO}
      focusId={focusId}
      onToggle={onToggle}
      onEscape={onEscape}
    >
      <Text color="blue" wrap="wrap">{systemPrompt}</Text>
    </TimelineEntryCollapsibleBox>
  );
}
