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
  parentFocusId?: string; // Focus target when pressing escape
  bottomSectionHeight?: number;
}

export default function TimelineDisplay({ timeline, delegateTimelines, focusId, parentFocusId, bottomSectionHeight }: TimelineDisplayProps) {
  const [focusedLine, setFocusedLine] = useState<number>(0); // Absolute line position in content
  const [lineScrollOffset, setLineScrollOffset] = useState<number>(0); // Line-based scrolling
  const [componentExpandState, setComponentExpandState] = useState<Map<string, boolean>>(new Map()); // Track expand/collapse state for all timeline components
  // Track which component is currently focused (null = timeline selection mode)
  const [focusedComponentId, setFocusedComponentId] = React.useState<string | null>(null);
  // Use focus manager with disabled automatic cycling
  const { isFocused } = useFocus({ id: focusId || 'timeline' });
  const { focusNext, focus } = useFocusManager();
  const [, terminalHeight] = useStdoutDimensions();
  const containerRef = useRef<any>(null);
  
  // Measure individual item heights - NOT estimates
  const itemRefs = useRef<Map<number, any>>(new Map());
  const [itemPositions, setItemPositions] = useState<number[]>([]);
  const [totalContentHeight, setTotalContentHeight] = useState<number>(0);
  
  // Force re-measurement when CollapsibleBox components expand/collapse
  const [measurementTrigger, setMeasurementTrigger] = useState<number>(0);
  const [itemToRefocusAfterMeasurement, setItemToRefocusAfterMeasurement] = useState<number>(-1);
  const [lastTimelineItemCount, setLastTimelineItemCount] = useState<number>(0);
  
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
  }, [timeline.items, itemRefs, measurementTrigger]);
  
  // After re-measurement, refocus on the first line of the remembered item
  useEffect(() => {
    if (itemToRefocusAfterMeasurement >= 0 && itemPositions.length > 0) {
      const newItemStart = itemPositions[itemToRefocusAfterMeasurement];
      logger.debug('CollapsibleBox toggle - after remeasurement', {
        itemToRefocusAfterMeasurement,
        newItemStart,
        itemPositions: itemPositions.slice(0, 5),
        willSetFocusedLine: newItemStart
      });
      if (newItemStart !== undefined) {
        setFocusedLine(newItemStart);
        // Reset flag after a delay
        setTimeout(() => {
          setItemToRefocusAfterMeasurement(-1);
        }, 50);
      }
    }
  }, [itemPositions, itemToRefocusAfterMeasurement]);
  
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
  
  // Track timeline item count changes to distinguish new content vs. height changes
  useEffect(() => {
    setLastTimelineItemCount(timeline.items.length);
  }, [timeline.items.length]);
  
  // Initialize to bottom when NEW CONTENT is added (but not during refocus after toggle)
  useEffect(() => {
    const hasNewContent = timeline.items.length > lastTimelineItemCount;
    
    if (totalContentHeight > 0 && itemToRefocusAfterMeasurement === -1 && hasNewContent) {
      // Only scroll to bottom for NEW timeline items, not height changes due to expansion
      const bottomLine = Math.max(0, totalContentHeight - 1);
      logger.debug('Auto-scroll to bottom triggered', {
        totalContentHeight,
        bottomLine,
        itemToRefocusAfterMeasurement,
        hasNewContent,
        timelineItemCount: timeline.items.length,
        lastTimelineItemCount,
        willSetFocusedLine: bottomLine
      });
      setFocusedLine(bottomLine);
      
      // Scroll to show the bottom
      const maxScroll = Math.max(0, totalContentHeight - viewportLines);
      setLineScrollOffset(maxScroll);
    } else {
      logger.debug('Auto-scroll to bottom skipped', {
        totalContentHeight,
        itemToRefocusAfterMeasurement,
        hasNewContent,
        timelineItemCount: timeline.items.length,
        lastTimelineItemCount,
        reason: totalContentHeight <= 0 ? 'no content' : 
                !hasNewContent ? 'no new content (height change only)' :
                'refocus in progress'
      });
    }
  }, [totalContentHeight, viewportLines, itemToRefocusAfterMeasurement, timeline.items.length, lastTimelineItemCount]); // When content height changes, scroll to bottom
  
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

  // Handle keyboard navigation - only register when focused and has content
  useInput(useCallback((input, key) => {
    if (key.escape) {
      // Handle escape based on focus hierarchy
      const currentFocusId = focusId || 'timeline';
      logger.debug('TimelineDisplay: Escape key pressed', {
        currentFocusId,
        parentFocusId,
        action: parentFocusId ? `focus(${parentFocusId})` : 'focusNext()'
      });
      
      if (parentFocusId) {
        // We're in a nested timeline - go back to parent focus
        focus(parentFocusId);
      } else {
        // We're in the main timeline - go to shell input
        focus('shell-input');
      }
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
    } else if (key.leftArrow || key.rightArrow || key.return) {
      // Handle timeline item interactions
      const focusedItemIndex = getFocusedItemIndex();
      if (focusedItemIndex >= 0 && focusedItemIndex < timeline.items.length) {
        const item = timeline.items[focusedItemIndex];
        
        // Generate component ID for this timeline item
        let componentId: string;
        if (item.type === 'tool_execution' && item.call?.toolName === 'delegate') {
          componentId = `delegation-${item.callId}`;
        } else if (item.type === 'tool_execution') {
          componentId = `tool-${item.callId}`;
        } else {
          const itemId = 'id' in item ? item.id : `${item.type}-${focusedItemIndex}`;
          const type = item.type === 'user_message' || item.type === 'agent_message' ? 'message' :
                      item.type === 'thinking' ? 'thinking' :
                      item.type === 'system_message' ? 'system' : 'item';
          componentId = `${type}-${itemId}`;
        }
        
        if (key.leftArrow || key.rightArrow) {
          // Toggle expand/collapse for any timeline component
          setComponentExpandState(prev => {
            const newState = new Map(prev);
            const currentExpanded = newState.get(componentId) ?? false;
            newState.set(componentId, !currentExpanded);
            return newState;
          });
        } else if (key.return) {
          // Focus into the selected component
          const currentFocusId = focusId || 'timeline';
          const targetComponentId = `${currentFocusId}-${componentId}`;
          setFocusedComponentId(targetComponentId);
          focus(targetComponentId);
        }
      }
    }
  }, [totalContentHeight, viewportLines, focusNext, focus, timeline.items, delegateTimelines, getFocusedItemIndex, parentFocusId]), { isActive: totalContentHeight > 0 });
  
  
  const focusedItemIndex = getFocusedItemIndex();
  
  // Handle escape key from focused components
  const handleEscape = useCallback(() => {
    if (focusedComponentId) {
      // We're focused on a component - go back to timeline selection
      setFocusedComponentId(null);
    } else if (parentFocusId) {
      // We're in a nested timeline - go back to parent focus
      focus(parentFocusId);
    } else {
      // We're in the main timeline - go to shell input
      focusNext();
    }
  }, [focusedComponentId, parentFocusId, focus, focusNext]);
  
  // Define triggerRemeasurement after getFocusedItemIndex is available
  const triggerRemeasurement = useCallback(() => {
    // Remember which item is currently focused before re-measurement
    const currentFocusedItemIndex = getFocusedItemIndex();
    logger.debug('CollapsibleBox toggle - before remeasurement', {
      currentFocusedItemIndex,
      focusedLine,
      totalContentHeight,
      itemPositions: itemPositions.slice(0, 5) // First 5 to avoid spam
    });
    setItemToRefocusAfterMeasurement(currentFocusedItemIndex);
    setMeasurementTrigger(prev => prev + 1);
  }, [getFocusedItemIndex, focusedLine, totalContentHeight, itemPositions]);
  
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
                  onToggle={triggerRemeasurement}
                  componentExpandState={componentExpandState}
                  currentFocusId={focusId}
                  onEscape={handleEscape}
                />
              </Box>
            );
          })}
        </Box>
        
        {/* Cursor overlay - inverts first character of focused line */}
	{ isFocused &&
        <Box 
          position="absolute"
          flexDirection="column"
          marginTop={-lineScrollOffset + focusedLine}
        >
          {/* Only render cursor on the focused line */}
          <Text backgroundColor="white" color="black">
            {'>'}
          </Text>
        </Box>
      } 
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

function TimelineItemDisplay({ item, delegateTimelines, isFocused, focusedLine, itemStartLine, onToggle, componentExpandState, currentFocusId, onEscape }: { 
  item: TimelineItem; 
  delegateTimelines?: Map<string, Timeline>;
  isFocused: boolean;
  focusedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  componentExpandState: Map<string, boolean>;
  currentFocusId?: string;
  onEscape?: () => void;
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
        focusId={`${currentFocusId || 'timeline'}-message-${item.id}`}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
        onEscape={onEscape}
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
        focusId={`${currentFocusId || 'timeline'}-message-${item.id}`}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
        onEscape={onEscape}
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
        focusId={`${currentFocusId || 'timeline'}-thinking-${item.id}`}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
        onEscape={onEscape}
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
        focusId={`${currentFocusId || 'timeline'}-system-${item.id}`}
        focusedLine={focusedLine}
        itemStartLine={itemStartLine}
        onToggle={onToggle}
        onEscape={onEscape}
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
        logger.debug('TimelineDisplay: Processing delegate tool call', { 
          callId: item.callId,
          toolName: item.call.toolName,
          hasDelegateTimelines: !!delegateTimelines,
          delegateTimelineCount: delegateTimelines?.size || 0
        });
        
        if (delegateTimelines) {
          const delegateThreadId = extractDelegateThreadId(item, delegateTimelines);
          logger.debug('TimelineDisplay: Delegate thread ID extraction result', {
            callId: item.callId,
            extractedThreadId: delegateThreadId,
            availableThreads: Array.from(delegateTimelines.keys()),
            toolResult: item.result?.output ? item.result.output.substring(0, 100) + '...' : 'no result'
          });
          
          const delegateTimeline = delegateThreadId ? delegateTimelines.get(delegateThreadId) : null;
          
          if (delegateTimeline && delegateThreadId) {
            const isExpanded = componentExpandState.get(item.callId) ?? true;
            logger.debug('TimelineDisplay: RENDERING delegation box', { 
              threadId: delegateThreadId,
              callId: item.callId,
              isExpanded,
              timelineItemCount: delegateTimeline.items.length
            });
            return (
              <DelegationBox 
                threadId={delegateThreadId}
                timeline={delegateTimeline}
                delegateTimelines={delegateTimelines}
                parentFocusId={currentFocusId || 'timeline'}
                focusId={`${currentFocusId || 'timeline'}-delegation-${item.callId}`}
                onToggle={onToggle}
                onEscape={onEscape}
              />
            );
          } else {
            logger.debug('TimelineDisplay: NOT rendering delegation box', {
              reason: 'missing timeline or threadId',
              callId: item.callId,
              delegateThreadId,
              hasTimeline: !!delegateTimeline,
              hasDelegateTimelines: !!delegateTimelines,
              delegateTimelineKeys: delegateTimelines ? Array.from(delegateTimelines.keys()) : []
            });
          }
        } else {
          logger.debug('TimelineDisplay: No delegate timelines provided', {
            callId: item.callId,
            toolName: item.call.toolName
          });
        }
      }
      
      return <ToolExecutionDisplay 
        callEvent={callEvent} 
        resultEvent={resultEvent}
        focusId={`${currentFocusId || 'timeline'}-tool-${item.callId}`}
        onToggle={onToggle}
        onEscape={onEscape}
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
