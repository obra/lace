// ABOUTME: Display component for SYSTEM_PROMPT events with collapsible interface
// ABOUTME: Shows the generated system prompt sent to AI model with expandable content

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { CollapsibleBox } from '../ui/CollapsibleBox.js';

interface SystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  onToggle?: () => void;
}

export function SystemPromptDisplay({ event, isStreaming, isFocused, onToggle }: SystemPromptDisplayProps) {
  const systemPrompt = event.data as string;
  
  return (
    <Box flexDirection="column" marginY={1} key={`system-prompt-${event.id}`}>
      <CollapsibleBox 
        label="🔧 System Prompt" 
        defaultExpanded={false}
        borderColor="blue"
        isFocused={isFocused}
        onToggle={onToggle}
      >
        <Box flexDirection="column">
          <Text color="blue" wrap="wrap">{systemPrompt}</Text>
        </Box>
      </CollapsibleBox>
    </Box>
  );
}