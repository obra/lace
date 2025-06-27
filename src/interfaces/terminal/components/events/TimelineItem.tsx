// ABOUTME: Individual timeline item component with dynamic tool renderer discovery
// ABOUTME: Handles all timeline item types with unified expansion behavior and automatic tool renderer selection

import React, { Suspense } from 'react';
import { Box, Text } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../thread-processor.js';
import { EventDisplay } from './EventDisplay.js';
import { GenericToolRenderer } from './tool-renderers/GenericToolRenderer.js';
import { getToolRenderer } from './tool-renderers/getToolRenderer.js';
import MessageDisplay from '../message-display.js';

interface TimelineItemProps {
  item: TimelineItemType;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  currentFocusId?: string;
}

interface DynamicToolRendererProps {
  item: Extract<TimelineItemType, { type: 'tool_execution' }>;
  isFocused: boolean;
  onToggle?: () => void;
}

function DynamicToolRenderer({ 
  item, 
  isFocused, 
  onToggle
}: DynamicToolRendererProps) {
  const [ToolRenderer, setToolRenderer] = React.useState<React.ComponentType<unknown> | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [debugInfo, setDebugInfo] = React.useState<string>('');

  React.useEffect(() => {
    let cancelled = false;
    setDebugInfo(`Looking for ${item.call.toolName}ToolRenderer...`);
    
    getToolRenderer(item.call.toolName).then(renderer => {
      if (!cancelled) {
        setToolRenderer(() => renderer);
        setIsLoading(false);
        setDebugInfo(renderer ? `Found: ${renderer.name}` : 'Not found, using Generic');
      }
    }).catch(error => {
      if (!cancelled) {
        setIsLoading(false);
        setDebugInfo(`Error: ${error.message}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [item.call.toolName]);

  if (isLoading) {
    // Add debug info to loading state
    const debugItem = {
      ...item,
      call: {
        ...item.call,
        input: {
          ...item.call.input,
          _debug: debugInfo
        }
      }
    };
    return <GenericToolRenderer 
      item={debugItem}
      isFocused={isFocused}
      onToggle={onToggle}
    />;
  }

  const RendererComponent = ToolRenderer || GenericToolRenderer;
  
  // Add debug info to final render
  const debugItem = {
    ...item,
    call: {
      ...item.call,
      input: {
        ...item.call.input,
        _debug: debugInfo
      }
    }
  };
  
  return <RendererComponent 
    item={debugItem}
    isFocused={isFocused}
    onToggle={onToggle}
  />;
}

export function TimelineItem({ 
  item, 
  isFocused, 
  focusedLine, 
  itemStartLine, 
  onToggle, 
  currentFocusId
}: TimelineItemProps) {
  switch (item.type) {
    case 'user_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'USER_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'agent_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'AGENT_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'thinking':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'THINKING',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'system_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: (item.originalEventType || 'LOCAL_SYSTEM_MESSAGE') as any,
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
      />;
      
    case 'tool_execution':
      return <DynamicToolRenderer 
        item={item}
        isFocused={isFocused}
        onToggle={onToggle}
      />;
      
    case 'ephemeral_message':
      return <MessageDisplay 
        message={{
          type: item.messageType as any,
          content: item.content,
          timestamp: item.timestamp
        }} 
        isFocused={isFocused}
      />;
      
    default:
      return <Box><Text>Unknown timeline item type</Text></Box>;
  }
}