// ABOUTME: Main event router component that maps thread events to specialized display components
// ABOUTME: Provides extensible architecture for different event types and future subagent support

import React from 'react';
import { Box, Text } from 'ink';
import { ThreadEvent } from '~/threads/types.js';
import { ToolCallDisplay } from '~/interfaces/terminal/components/events/ToolCallDisplay.js';
import { ToolResultDisplay } from '~/interfaces/terminal/components/events/ToolResultDisplay.js';
import { UserMessageDisplay } from '~/interfaces/terminal/components/events/UserMessageDisplay.js';
import { AgentMessageDisplay } from '~/interfaces/terminal/components/events/AgentMessageDisplay.js';
import { SystemMessageDisplay } from '~/interfaces/terminal/components/events/SystemMessageDisplay.js';
import { SystemPromptDisplay } from '~/interfaces/terminal/components/events/SystemPromptDisplay.js';
import { UserSystemPromptDisplay } from '~/interfaces/terminal/components/events/UserSystemPromptDisplay.js';

interface EventDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
  isSelected?: boolean; // Whether timeline cursor is on this item (for CollapsibleBox)
  focusedLine?: number;
  itemStartLine?: number;
  onToggle?: () => void;
}

export function EventDisplay({
  event,
  isStreaming,
  isSelected,
  focusedLine,
  itemStartLine,
  onToggle,
}: EventDisplayProps) {
  const componentMap = {
    TOOL_CALL: ToolCallDisplay,
    TOOL_RESULT: ToolResultDisplay,
    USER_MESSAGE: UserMessageDisplay,
    AGENT_MESSAGE: AgentMessageDisplay,
    LOCAL_SYSTEM_MESSAGE: SystemMessageDisplay,
    SYSTEM_PROMPT: SystemPromptDisplay,
    USER_SYSTEM_PROMPT: UserSystemPromptDisplay,
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
      <Component
        event={event}
        isStreaming={isStreaming}
        isSelected={isSelected}
        onToggle={onToggle}
      />
    </Box>
  );
}
