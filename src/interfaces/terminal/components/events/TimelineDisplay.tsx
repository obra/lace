// ABOUTME: Display component for processed timeline items from ThreadProcessor
// ABOUTME: Renders timeline items in chronological order with appropriate UI components

import React from 'react';
import { Box } from 'ink';
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
}

export default function TimelineDisplay({ timeline, delegateTimelines }: TimelineDisplayProps) {
  // Debug: Log delegate timelines info
  logger.debug('TimelineDisplay rendering', {
    timelineItems: timeline.items.length,
    delegateTimelineCount: delegateTimelines?.size || 0,
    delegateThreads: delegateTimelines ? Array.from(delegateTimelines.keys()) : []
  });
  
  return (
    <Box flexDirection="column">
      {timeline.items.map((item, index) => (
        <Box key={`timeline-item-${index}`}>
          <TimelineItemDisplay item={item} delegateTimelines={delegateTimelines} />
        </Box>
      ))}
    </Box>
  );
}

function TimelineItemDisplay({ item, delegateTimelines }: { 
  item: TimelineItem; 
  delegateTimelines?: Map<string, Timeline>;
}) {
  switch (item.type) {
    case 'user_message':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'USER_MESSAGE',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
    case 'agent_message':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'AGENT_MESSAGE',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
    case 'thinking':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'THINKING',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
    case 'system_message':
      return <EventDisplay event={{
        id: item.id,
        threadId: '',
        type: 'LOCAL_SYSTEM_MESSAGE',
        timestamp: item.timestamp,
        data: item.content
      }} />;
      
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
      />;
      
    case 'ephemeral_message':
      return <MessageDisplay message={{
        type: item.messageType as any,
        content: item.content,
        timestamp: item.timestamp
      }} />;
      
      
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