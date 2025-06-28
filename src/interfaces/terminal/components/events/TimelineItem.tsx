// ABOUTME: Individual timeline item component with dynamic tool renderer discovery
// ABOUTME: Handles all timeline item types with unified expansion behavior and automatic tool renderer selection

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
  isSelected: boolean; // Whether timeline cursor is on this item
  onToggle?: () => void;
  onExpansionToggle?: () => void;
}

function DynamicToolRenderer({ item, isSelected, onToggle }: DynamicToolRendererProps) {
  const [ToolRenderer, setToolRenderer] = React.useState<React.ComponentType<unknown> | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [debugInfo, setDebugInfo] = React.useState<string>('');

  React.useEffect(() => {
    let cancelled = false;
    setDebugInfo(`Looking for ${item.call.name}ToolRenderer...`);

    getToolRenderer(item.call.name)
      .then((renderer) => {
        if (!cancelled) {
          setToolRenderer(() => renderer);
          setIsLoading(false);
          setDebugInfo(renderer ? `Found: ${renderer.name}` : 'Not found, using Generic');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setIsLoading(false);
          setDebugInfo(`Error: ${error.message}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item.call.name]);

  if (isLoading) {
    // Add debug info to loading state
    const debugItem = {
      ...item,
      call: {
        ...item.call,
        arguments: {
          ...item.call.arguments,
          _debug: debugInfo,
        },
      },
    };
    return (
      <GenericToolRenderer
        item={debugItem}
        isSelected={isSelected}
        onToggle={onToggle}
      />
    );
  }

  const RendererComponent = ToolRenderer || GenericToolRenderer;

  // Add debug info to final render
  const debugItem = {
    ...item,
    call: {
      ...item.call,
      arguments: {
        ...item.call.arguments,
        _debug: debugInfo,
      },
    },
  };

  return (
    <RendererComponent
      item={debugItem}
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
          <DynamicToolRenderer
            item={item}
            isSelected={isSelected}
              onToggle={onToggle}
          />
        </ToolRendererErrorBoundary>
      );

    case 'ephemeral_message':
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
