// ABOUTME: Individual timeline item component with dynamic tool renderer discovery
// ABOUTME: Handles all timeline item types with unified expansion behavior and automatic tool renderer selection

import React, { Suspense, useImperativeHandle, useRef, forwardRef, useMemo } from 'react';
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
import { TimelineItemRef, canTimelineItemAcceptFocus } from '../timeline-item-focus.js';
import { logger } from '../../../../utils/logger.js';

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

const DynamicToolRenderer = forwardRef<TimelineItemRef, DynamicToolRendererProps>(({ item, isSelected, onToggle }, ref) => {
  const [ToolRenderer, setToolRenderer] = React.useState<React.ComponentType<unknown> | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [debugInfo, setDebugInfo] = React.useState<string>('');
  const toolRendererRef = useRef<TimelineItemRef>(null);

  // Expose enterFocus method through ref
  useImperativeHandle(ref, () => {
    logger.debug('DynamicToolRenderer: useImperativeHandle setting up ref', {
      toolName: item.call.name,
      hasRef: !!ref,
    });
    return {
      enterFocus: () => {
        // Only delegate to tool renderer if this item can accept focus
        const canAcceptFocus = canTimelineItemAcceptFocus(item);
        logger.debug('DynamicToolRenderer: enterFocus called', {
          canAcceptFocus,
          hasToolRendererRef: !!toolRendererRef.current,
          hasEnterFocus: !!toolRendererRef.current?.enterFocus,
          toolName: item.call.name,
          callId: item.callId,
          timestamp: item.timestamp,
        });
        if (canAcceptFocus) {
          toolRendererRef.current?.enterFocus?.();
        }
      },
    };
  }, [item.call.name, item.callId, item.result]);

  React.useEffect(() => {
    const abortController = new AbortController();
    setDebugInfo(`Looking for ${item.call.name}ToolRenderer...`);

    getToolRenderer(item.call.name)
      .then((renderer) => {
        if (!abortController.signal.aborted) {
          setToolRenderer(() => renderer);
          setIsLoading(false);
          setDebugInfo(renderer ? `Found: ${renderer.name}` : 'Not found, using Generic');
        }
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
          setDebugInfo(`Error: ${error.message}`);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [item.call.name]);

  // Memoize debugItem to prevent object recreation on every render
  const debugItem = useMemo(() => ({
    ...item,
    call: {
      ...item.call,
      arguments: {
        ...item.call.arguments,
        _debug: debugInfo,
      },
    },
  }), [item, debugInfo]);

  if (isLoading) {
    return (
      <GenericToolRenderer
        item={debugItem}
        isSelected={isSelected}
        onToggle={onToggle}
      />
    );
  }

  const RendererComponent = ToolRenderer || GenericToolRenderer;

  return (
    <RendererComponent
      ref={toolRendererRef}
      item={debugItem}
      isSelected={isSelected}
      onToggle={onToggle}
    />
  );
});

export const TimelineItem = forwardRef<TimelineItemRef, TimelineItemProps>(({
  item,
  isSelected,
  selectedLine,
  itemStartLine,
  onToggle,
}, ref) => {
  // For non-focusable items, provide a no-op ref
  useImperativeHandle(ref, () => ({
    enterFocus: () => {
      // No-op for non-focusable items
    },
  }), []);

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
            ref={ref}
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
});
