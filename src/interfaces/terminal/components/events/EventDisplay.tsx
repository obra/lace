// ABOUTME: Main event router component that maps thread events to specialized display components
// ABOUTME: Provides extensible architecture for different event types and future subagent support

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { ToolCallDisplay } from './ToolCallDisplay.js';
import { ToolResultDisplay } from './ToolResultDisplay.js';
import { UserMessageDisplay } from './UserMessageDisplay.js';
import { AgentMessageDisplay } from './AgentMessageDisplay.js';
import { SystemMessageDisplay } from './SystemMessageDisplay.js';
import { ThinkingDisplay } from './ThinkingDisplay.js';

interface EventDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isFocused?: boolean;
}

export function EventDisplay({ event, isStreaming, isFocused }: EventDisplayProps) {
  const componentMap = {
    'TOOL_CALL': ToolCallDisplay,
    'TOOL_RESULT': ToolResultDisplay,
    'USER_MESSAGE': UserMessageDisplay,
    'AGENT_MESSAGE': AgentMessageDisplay,
    'LOCAL_SYSTEM_MESSAGE': SystemMessageDisplay,
    'THINKING': ThinkingDisplay,
  } as const;

  const Component = componentMap[event.type];
  
  if (!Component) {
    // Fallback for unknown event types
    return (
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text color="red">Unknown event type: {event.type}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Component event={event} isStreaming={isStreaming} isFocused={isFocused} />
    </Box>
  );
}