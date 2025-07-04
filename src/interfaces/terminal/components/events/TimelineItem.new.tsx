// ABOUTME: Individual timeline item component with simplified tool renderer discovery
// ABOUTME: Handles all timeline item types with unified expansion behavior and registry-based tool renderer selection

import React, { Suspense } from 'react';
import { Box, Text } from 'ink';
import {
  Timeline,
  TimelineItem as TimelineItemType,
  EphemeralMessage,
} from '../../../thread-processor.js';
import { EventType } from '../../../../threads/types.js';
import { EventDisplay } from './EventDisplay.js';
import { GenericToolRenderer } from './tool-renderers/GenericToolRenderer.js';
import { getToolRenderer } from './tool-renderers/getToolRenderer.js';
import { ToolRendererErrorBoundary } from './ToolRendererErrorBoundary.js';
import MessageDisplay from '../message-display.js';
import { logger } from '../../../../utils/logger.js';

interface TimelineItemProps {
  item: TimelineItemType;
  isSelected: boolean; // Whether timeline cursor is on this item (for expansion)
  selectedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  onExpansionToggle?: () => void; // Called when left/right arrows should toggle expansion
}

interface ToolRendererProps {
  item: Extract<TimelineItemType, { type: 'tool_execution' }>;
  isSelected: boolean; // Whether timeline cursor is on this item
  onToggle?: () => void;
  onExpansionToggle?: () => void;
}

function ToolRenderer({ item, isSelected, onToggle }: ToolRendererProps) {
  const [RendererComponent, setRendererComponent] = React.useState<React.ComponentType<any> | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const abortController = new AbortController();

    logger.debug('ToolRenderer: Starting renderer discovery', {
      toolName: item.call.name,
      callId: item.callId
    });

    getToolRenderer(item.call.name)
      .then((renderer) => {
        if (!abortController.signal.aborted) {
          setRendererComponent(() => renderer);
          setIsLoading(false);
          
          logger.info('ToolRenderer: Renderer resolution complete', {
            toolName: item.call.name,
            callId: item.callId,
            found: !!renderer,
            rendererName: renderer?.name,
            willUseGeneric: !renderer
          });
        }
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
          
          logger.error('ToolRenderer: Renderer discovery error', {
            toolName: item.call.name,
            callId: item.callId,
            error: error.message,
            willUseGeneric: true
          });
        }
      });

    return () => {
      abortController.abort();
    };
  }, [item.call.name]);

  // Show loading state with GenericToolRenderer
  if (isLoading) {
    return (
      <GenericToolRenderer
        item={item}
        isSelected={isSelected}
        onToggle={onToggle}
        isStreaming={true}
      />
    );
  }

  const RendererToUse = RendererComponent || GenericToolRenderer;

  return (
    <RendererToUse
      item={item}
      isSelected={isSelected}
      onToggle={onToggle}
    />
  );
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
      );

    case 'agent_message':
      return (
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
      );

    case 'system_message':
      return (
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
      );

    case 'tool_execution':
      return (
        <ToolRendererErrorBoundary
          item={item}
          isSelected={isSelected}
          onToggle={onToggle}
        >
          <ToolRenderer
            item={item}
            isSelected={isSelected}
            onToggle={onToggle}
          />
        </ToolRendererErrorBoundary>
      );

    case 'ephemeral_message':
      // For assistant ephemeral messages, use EventDisplay with AgentMessageDisplay
      // which provides proper thinking block handling and side indicators
      if (item.messageType === 'assistant') {
        return (
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