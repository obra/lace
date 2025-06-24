// ABOUTME: Display component for USER_SYSTEM_PROMPT events with collapsible interface  
// ABOUTME: Shows user instructions from LACE_DIR/instructions.md with expandable content

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { CollapsibleBox } from '../ui/CollapsibleBox.js';

interface UserSystemPromptDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
  onToggle?: () => void;
}

export function UserSystemPromptDisplay({ event, isStreaming, isFocused, onToggle }: UserSystemPromptDisplayProps) {
  const userInstructions = event.data as string;
  
  return (
    <Box flexDirection="column" marginY={1} key={`user-prompt-${event.id}`}>
      <CollapsibleBox 
        label="📋 User Instructions" 
        defaultExpanded={false}
        borderColor="cyan"
        isFocused={isFocused}
        onToggle={onToggle}
      >
        <Box flexDirection="column">
          <Text color="cyan" wrap="wrap">{userInstructions}</Text>
        </Box>
      </CollapsibleBox>
    </Box>
  );
}