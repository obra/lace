// ABOUTME: Display component for processed timeline items with viewport navigation
// ABOUTME: Supports jump navigation (PageUp/Down, g/G) and auto-scrolling for long conversations

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, useInput, useFocus, useFocusManager, Text, measureElement } from 'ink';
import useStdoutDimensions from '../../../../utils/use-stdout-dimensions.js';
import { Timeline, TimelineItem } from '../../../thread-processor.js';
import { EventDisplay } from './EventDisplay.js';
import { ToolExecutionDisplay } from './ToolExecutionDisplay.js';
import { DelegationBox } from './DelegationBox.js';
import MessageDisplay from '../message-display.js';
import { useThreadProcessor } from '../../terminal-interface.js';
import { logger } from '../../../../utils/logger.js';

interface TimelineDisplayProps {
  timeline: Timeline;
  delegateTimelines?: Map<string, Timeline>;
  focusId?: string;
  bottomSectionHeight?: number;
}

export default function TimelineDisplay({ timeline, delegateTimelines, focusId, bottomSectionHeight }: TimelineDisplayProps) {
  const [focusedLine, setFocusedLine] = useState<number>(0); // Absolute line position in content
  const [lineScrollOffset, setLineScrollOffset] = useState<number>(0); // Line-based scrolling
  // Use focus manager with disabled automatic cycling
  const { isFocused } = useFocus({ id: focusId || 'timeline' });
  const { focusNext } = useFocusManager();
  const [, terminalHeight] = useStdoutDimensions();
  const containerRef = useRef<any>(null);
  
  // Measure individual item heights - NOT estimates
  const itemRefs = useRef<Map<number, any>>(new Map());
  const [itemPositions, setItemPositions] = useState<number[]>([]);
  const [totalContentHeight, setTotalContentHeight] = useState<number>(0);
  
  // Measure scroll indicator heights
  const topIndicatorRef = useRef<any>(null);
  const bottomIndicatorRef = useRef<any>(null);
  const [indicatorHeights, setIndicatorHeights] = useState<{ top: number; bottom: number }>({ top: 0, bottom: 0 });
  
  // Calculate viewport height using actual measured heights (skip indicators for now - circular dependency)
  const viewportLines = bottomSectionHeight ? 
    Math.max(10, (terminalHeight || 30) - bottomSectionHeight) : 
    10; // wait for measurement
    
  // Calculate scroll indicator visibility (needed for measurement effect)
  const hasMoreAbove = lineScrollOffset > 0;
  const hasMoreBelow = totalContentHeight > 0 && lineScrollOffset + viewportLines < totalContentHeight;
  
  // Measure actual individual item heights after render
  useEffect(() => {
    const positions: number[] = [];
    let currentPosition = 0;
    
    for (let i = 0; i < timeline.items.length; i++) {
      positions[i] = currentPosition;
      
      const itemRef = itemRefs.current.get(i);
      if (itemRef) {
        const { height } = measureElement(itemRef);
        currentPosition += height;
      } else {
        // Only use fallback until ref is available
        currentPosition += 3;
      }
    }
    
    setItemPositions(positions);
    setTotalContentHeight(currentPosition);
  }, [timeline.items, itemRefs]);
  
  // Measure scroll indicator heights
  useEffect(() => {
    const topHeight = topIndicatorRef.current ? measureElement(topIndicatorRef.current).height : 0;
    const bottomHeight = bottomIndicatorRef.current ? measureElement(bottomIndicatorRef.current).height : 0;
    setIndicatorHeights({ top: topHeight, bottom: bottomHeight });
  }, [hasMoreAbove, hasMoreBelow]); // Re-measure when indicators show/hide
  
  // Auto-scroll viewport when focused line would go off-screen
  useEffect(() => {
    const topVisible = lineScrollOffset;
    const bottomVisible = lineScrollOffset + viewportLines - 1;
    
    if (focusedLine < topVisible) {
      // Focused line is above viewport, scroll up to show it
      setLineScrollOffset(focusedLine);
    } else if (focusedLine > bottomVisible) {
      // Focused line is below viewport, scroll down to show it
      setLineScrollOffset(focusedLine - viewportLines + 1);
    }
  }, [focusedLine, viewportLines]);
  
  // Initialize to bottom when content changes
  useEffect(() => {
    if (totalContentHeight > 0) {
      // Start at the bottom of content
      const bottomLine = Math.max(0, totalContentHeight - 1);
      setFocusedLine(bottomLine);
      
      // Scroll to show the bottom
      const maxScroll = Math.max(0, totalContentHeight - viewportLines);
      setLineScrollOffset(maxScroll);
    }
  }, [totalContentHeight, viewportLines]); // When content height changes, scroll to bottom
  
  // Handle keyboard navigation - only register when focused and has content
  useInput(useCallback((input, key) => {
    if (key.escape) {
      // Escape switches back to shell input mode
      focusNext();
      return;
    }
    
    if (key.upArrow) {
      // Move focus up by 1 line
      setFocusedLine(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      // Move focus down by 1 line
      setFocusedLine(prev => Math.min(totalContentHeight - 1, prev + 1));
    } else if (key.pageUp) {
      // Jump up by viewport size
      setFocusedLine(prev => Math.max(0, prev - viewportLines));
    } else if (key.pageDown) {
      // Jump down by viewport size
      setFocusedLine(prev => Math.min(totalContentHeight - 1, prev + viewportLines));
    } else if (input === 'g') {
      // Go to top (first line)
      setFocusedLine(0);
    } else if (input === 'G') {
      // Go to bottom (last line)
      setFocusedLine(Math.max(0, totalContentHeight - 1));
    }
  }, [totalContentHeight, viewportLines, focusNext]), { isActive: isFocused && totalContentHeight > 0 });
  
  
  // Calculate which item contains the focused line
  const getFocusedItemIndex = useCallback(() => {
    if (itemPositions.length === 0) return -1;
    
    for (let i = 0; i < itemPositions.length; i++) {
      const itemStart = itemPositions[i];
      const itemEnd = i + 1 < itemPositions.length ? itemPositions[i + 1] : totalContentHeight;
      
      if (focusedLine >= itemStart && focusedLine < itemEnd) {
        return i;
      }
    }
    
    return -1;
  }, [focusedLine, itemPositions, totalContentHeight]);
  
  const focusedItemIndex = getFocusedItemIndex();
  
  // Debug: Log delegate timelines info
  logger.debug('TimelineDisplay rendering', {
    timelineItems: timeline.items.length,
    delegateTimelineCount: delegateTimelines?.size || 0,
    delegateThreads: delegateTimelines ? Array.from(delegateTimelines.keys()) : [],
    focusedLine,
    focusedItemIndex,
    lineScrollOffset,
    viewportLines,
    terminalHeight,
    componentIsFocused: isFocused
  });
  
  return (
    <Box flexDirection="column" flexGrow={1} ref={containerRef}>
      {/* Scroll indicator - more content above */}
      {hasMoreAbove && (
        <Box justifyContent="center" ref={topIndicatorRef}>
          <Text color="dim">↑ content above (line {lineScrollOffset}) ↑</Text>
        </Box>
      )}
      
      {/* Viewport container with cursor overlay */}
      <Box 
        height={viewportLines}
        flexDirection="column"
        overflow="hidden"  // Essential for proper clipping!
      >
        {/* Content container */}
        <Box 
          flexDirection="column" 
          marginTop={-lineScrollOffset}  // This is the key scrolling mechanism
          flexShrink={0}  // Prevent content from shrinking
        >
          {timeline.items.map((item, index) => {
            const isItemFocused = index === focusedItemIndex;
            return (
              <Box 
                key={`timeline-item-${index}`} 
                flexDirection="column"
                ref={(ref) => {
                  if (ref) {
                    itemRefs.current.set(index, ref);
                  } else {
                    itemRefs.current.delete(index);
                  }
                }}
              >
                <TimelineItemDisplay 
                  item={item} 
                  delegateTimelines={delegateTimelines}
                  isFocused={isItemFocused}
                  focusedLine={focusedLine}
                  itemStartLine={itemPositions[index] || 0}
                />
              </Box>
            );
          })}
        </Box>
        
        {/* Cursor overlay - inverts first character of focused line */}
        <Box 
          position="absolute"
          flexDirection="column"
          marginTop={-lineScrollOffset + focusedLine}
        >
          {/* Only render cursor on the focused line */}
          <Text backgroundColor="white" color="black">
            {' '}
          </Text>
        </Box>
      </Box>
      
      {/* Scroll indicator - more content below */}
      {hasMoreBelow && (
        <Box justifyContent="center" ref={bottomIndicatorRef}>
          <Text color="dim">↓ content below ↓</Text>
        </Box>
      )}
      
    </Box>
  );
}

function TimelineItemDisplay({ item, delegateTimelines, isFocused, focusedLine, itemStartLine }: { 
  item: TimelineItem; 
  delegateTimelines?: Map<string, Timeline>;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
}) {
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
      />;
      
    case 'system_message':
      return <EventDisplay 
        event={{
          id: item.id,
          threadId: '',
          type: 'LOCAL_SYSTEM_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        }} 
        isFocused={isFocused}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
      />;
      
    case 'tool_execution':
      const callEvent = {
        id: `${item.callId}-call`,
        threadId: '',
        type: 'TOOL_CALL' as const,
        timestamp: item.timestamp,
        data: item.call
      };
      
      const resultEvent = item.result ? {
        id: `${item.callId}-result`,
        threadId: '',
        type: 'TOOL_RESULT' as const,
        timestamp: item.timestamp,
        data: item.result
      } : undefined;
      
      // Check if this is a delegate tool call
      if (item.call.toolName === 'delegate') {
        logger.debug('Found delegate tool call', { callId: item.callId });
        
        if (delegateTimelines) {
          const delegateThreadId = extractDelegateThreadId(item, delegateTimelines);
          logger.debug('Delegate thread ID extraction', {
            extractedThreadId: delegateThreadId,
            availableThreads: Array.from(delegateTimelines.keys())
          });
          
          const delegateTimeline = delegateThreadId ? delegateTimelines.get(delegateThreadId) : null;
          
          if (delegateTimeline && delegateThreadId) {
            logger.debug('Rendering delegation box', { threadId: delegateThreadId });
            return (
              <Box flexDirection="column">
                <ToolExecutionDisplay 
                  callEvent={callEvent} 
                  resultEvent={resultEvent}
                  isFocused={isFocused}
                />
                <DelegationBox 
                  threadId={delegateThreadId}
                  timeline={delegateTimeline}
                  delegateTimelines={delegateTimelines}
                />
              </Box>
            );
          } else {
            logger.debug('NOT rendering delegation box', {
              reason: 'missing timeline or threadId',
              delegateThreadId,
              hasTimeline: !!delegateTimeline
            });
          }
        } else {
          logger.debug('No delegate timelines provided to TimelineDisplay');
        }
      }
      
      return <ToolExecutionDisplay 
        callEvent={callEvent} 
        resultEvent={resultEvent}
        isFocused={isFocused}
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
      return <Box>Unknown timeline item type</Box>;
  }
}

// Helper function to extract delegate thread ID from tool execution
function extractDelegateThreadId(
  item: Extract<TimelineItem, { type: 'tool_execution' }>,
  delegateTimelines: Map<string, Timeline>
): string | null {
  logger.debug('Extracting delegate thread ID', { callId: item.callId });
  
  // Strategy 1: Look for thread ID in tool result
  if (item.result && typeof item.result.output === 'string') {
    const match = item.result.output.match(/Thread: ([^\)]+)/);
    if (match) {
      logger.debug('Found thread ID in tool result', { threadId: match[1] });
      return match[1];
    }
  }
  
  // Strategy 2: Find delegate thread that started near this tool call (within 5 seconds)
  for (const [threadId, timeline] of delegateTimelines.entries()) {
    const firstItem = timeline.items[0];
    if (firstItem) {
      const timeDiff = Math.abs(firstItem.timestamp.getTime() - item.timestamp.getTime());
      if (timeDiff < 5000) {
        logger.debug('Found delegate thread by temporal proximity', {
          threadId,
          timeDiffMs: timeDiff
        });
        return threadId;
      }
    }
  }
  
  logger.debug('No delegate thread ID found');
  return null;
}