// ABOUTME: Individual timeline item component with clean tool renderer selection
// ABOUTME: Handles all timeline item types with unified expansion behavior and registry-based tool renderer selection

import React from 'react';
import { Box, Text } from 'ink';
import {
  Timeline,
  TimelineItem as TimelineItemType,
  EphemeralMessage,
} from '../../../thread-processor.js';
import { EventType } from '../../../../threads/types.js';
import { EventDisplay } from './EventDisplay.js';
import { getToolRenderer } from './tool-renderers/toolRendererRegistry.js';
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

interface ToolRendererSelectorProps {
  item: Extract<TimelineItemType, { type: 'tool_execution' }>;
  isSelected: boolean; // Whether timeline cursor is on this item
  onToggle?: () => void;
}

function ToolRendererSelector({ item, isSelected, onToggle }: ToolRendererSelectorProps) {
  // Get the appropriate renderer synchronously from registry
  const ToolRenderer = getToolRenderer(item.call.name);

  return (
    <ToolRenderer
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
          <ToolRendererSelector
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
