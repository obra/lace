// ABOUTME: Individual timeline item component with dynamic tool renderer discovery
// ABOUTME: Handles all timeline item types with unified expansion behavior and automatic tool renderer selection

import React from 'react';
import { Box, Text } from 'ink';
import { TimelineItem as TimelineItemType, EphemeralMessage } from '~/interfaces/timeline-types';
import { EventType } from '~/threads/types';
import { EventDisplay } from '~/interfaces/terminal/components/events/EventDisplay';
import { GenericToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/GenericToolRenderer';
import { getToolRenderer } from '~/interfaces/terminal/components/events/tool-renderers/getToolRenderer';
import { ToolRendererErrorBoundary } from '~/interfaces/terminal/components/events/ToolRendererErrorBoundary';
import MessageDisplay from '~/interfaces/terminal/components/message-display';
import { logger } from '~/utils/logger';
import { ToolRendererProps } from '~/interfaces/terminal/components/events/tool-renderers/components/shared';
import { TimelineItemProvider } from '~/interfaces/terminal/components/events/contexts/TimelineItemContext';

interface TimelineItemProps {
  item: TimelineItemType;
  isSelected: boolean; // Whether timeline cursor is on this item (for expansion)
  selectedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  onExpansionToggle?: () => void; // Called when left/right arrows should toggle expansion
}

interface DynamicToolRendererProps {
  item: Extract<TimelineItemType, { type: 'tool_execution' }>;
  isSelected: boolean;
  onToggle?: () => void;
}

function DynamicToolRenderer({
  item,
  isSelected: _isSelected,
  onToggle: _onToggle,
}: DynamicToolRendererProps) {
  const [ToolRenderer, setToolRenderer] =
    React.useState<React.ComponentType<ToolRendererProps> | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    getToolRenderer(item.call.name)
      .then((renderer) => {
        setToolRenderer(() => renderer as React.ComponentType<ToolRendererProps>);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        logger.error('DynamicToolRenderer: Failed to load renderer', {
          toolName: item.call.name,
          error: error instanceof Error ? error.message : String(error),
        });
        setIsLoading(false);
      });
  }, [item.call.name]);

  // For cached renderers, this will only show briefly on first render
  if (isLoading) {
    return <GenericToolRenderer item={item} />;
  }

  const RendererComponent = ToolRenderer || GenericToolRenderer;
  return <RendererComponent item={item} />;
}

export function TimelineItem({
  item,
  isSelected,
  selectedLine,
  itemStartLine,
  onToggle,
}: TimelineItemProps) {
  switch (item.type) {
    case 'user_message':
      return (
        <TimelineItemProvider
          isSelected={isSelected}
          onToggle={onToggle}
          focusedLine={selectedLine}
          itemStartLine={itemStartLine}
        >
          <EventDisplay
            event={{
              id: item.id,
              threadId: '',
              type: 'USER_MESSAGE',
              timestamp: item.timestamp,
              data: item.content,
            }}
            isSelected={isSelected}
            focusedLine={selectedLine}
            itemStartLine={itemStartLine}
            onToggle={onToggle}
          />
        </TimelineItemProvider>
      );

    case 'agent_message':
      return (
        <TimelineItemProvider
          isSelected={isSelected}
          onToggle={onToggle}
          focusedLine={selectedLine}
          itemStartLine={itemStartLine}
        >
          <EventDisplay
            event={{
              id: item.id,
              threadId: '',
              type: 'AGENT_MESSAGE',
              timestamp: item.timestamp,
              data: item.content,
            }}
            isSelected={isSelected}
            focusedLine={selectedLine}
            itemStartLine={itemStartLine}
            onToggle={onToggle}
          />
        </TimelineItemProvider>
      );

    case 'system_message':
      return (
        <TimelineItemProvider
          isSelected={isSelected}
          onToggle={onToggle}
          focusedLine={selectedLine}
          itemStartLine={itemStartLine}
        >
          <EventDisplay
            event={{
              id: item.id,
              threadId: '',
              type: (item.originalEventType || 'LOCAL_SYSTEM_MESSAGE') as EventType,
              timestamp: item.timestamp,
              data: item.content,
            }}
            isSelected={isSelected}
            focusedLine={selectedLine}
            itemStartLine={itemStartLine}
            onToggle={onToggle}
          />
        </TimelineItemProvider>
      );

    case 'tool_execution':
      return (
        <TimelineItemProvider
          isSelected={isSelected}
          onToggle={onToggle}
          focusedLine={selectedLine}
          itemStartLine={itemStartLine}
        >
          <ToolRendererErrorBoundary item={item} isSelected={isSelected} onToggle={onToggle}>
            <DynamicToolRenderer item={item} isSelected={isSelected} onToggle={onToggle} />
          </ToolRendererErrorBoundary>
        </TimelineItemProvider>
      );

    case 'ephemeral_message':
      // For assistant ephemeral messages, use EventDisplay with AgentMessageDisplay
      // which provides proper thinking block handling and side indicators
      if (item.messageType === 'assistant') {
        return (
          <TimelineItemProvider
            isSelected={isSelected}
            onToggle={onToggle}
            focusedLine={selectedLine}
            itemStartLine={itemStartLine}
          >
            <EventDisplay
              event={{
                id: `ephemeral-${item.timestamp.getTime()}`,
                threadId: '',
                type: 'AGENT_MESSAGE',
                timestamp: item.timestamp,
                data: item.content,
              }}
              isSelected={isSelected}
              focusedLine={selectedLine}
              itemStartLine={itemStartLine}
              onToggle={onToggle}
              isStreaming={true}
            />
          </TimelineItemProvider>
        );
      }

      // For other ephemeral messages, use the original MessageDisplay
      return (
        <MessageDisplay
          message={{
            type: item.messageType as EphemeralMessage['type'],
            content: item.content,
            timestamp: item.timestamp,
          }}
        />
      );

    default:
      return (
        <Box>
          <Text>Unknown timeline item type</Text>
        </Box>
      );
  }
}
