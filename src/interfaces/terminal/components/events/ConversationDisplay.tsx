// ABOUTME: O(1) conversation display using StreamingTimelineProcessor for optimal performance
// ABOUTME: Eliminates O(n) reprocessing by using incremental timeline updates

import React, { useMemo } from 'react';
import { Box } from 'ink';
import { Timeline, EphemeralMessage } from '../../../timeline-types.js';
import { useStreamingTimelineProcessor } from '../../terminal-interface.js';
import TimelineDisplay from './TimelineDisplay.js';

interface Message {
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
}

interface ConversationDisplayProps {
  ephemeralMessages: Message[];
  bottomSectionHeight?: number;
  isTimelineLayoutDebugVisible?: boolean;
  timelineVersion?: number; // For triggering React updates when timeline changes
}

export function ConversationDisplay({
  ephemeralMessages,
  bottomSectionHeight,
  isTimelineLayoutDebugVisible,
  timelineVersion,
}: ConversationDisplayProps) {
  // Use StreamingTimelineProcessor for O(1) timeline access
  const streamingProcessor = useStreamingTimelineProcessor();

  // Get current timeline state (O(1) operation)
  // Use timelineVersion to trigger updates when timeline changes
  const timeline = useMemo(() => {
    const startTime = performance.now();
    const result = streamingProcessor.getTimeline();
    const endTime = performance.now();
    const renderTime = endTime - startTime;
    
    // Log performance for monitoring (only if significant)
    if (renderTime > 1) {
      console.debug('Timeline rendering performance', {
        timelineItems: result.items.length,
        renderTimeMs: renderTime.toFixed(3),
        itemsPerMs: (result.items.length / renderTime).toFixed(1),
      });
    }
    
    return result;
  }, [streamingProcessor, timelineVersion]);

  // Convert ephemeral messages to EphemeralMessage format and merge into timeline
  const finalTimeline = useMemo(() => {
    const startTime = performance.now();
    
    if (ephemeralMessages.length === 0) {
      return timeline;
    }

    // Convert Message[] to EphemeralMessage[] format
    const ephemeralItems: EphemeralMessage[] = ephemeralMessages.map(msg => ({
      type: msg.type,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    // Create ephemeral timeline items
    const ephemeralTimelineItems = ephemeralItems.map(msg => ({
      type: 'ephemeral_message' as const,
      messageType: msg.type,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    // Merge with existing timeline and sort chronologically
    const allItems = [...timeline.items, ...ephemeralTimelineItems].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    const result = {
      items: allItems,
      metadata: {
        ...timeline.metadata,
        lastActivity: allItems.length > 0 
          ? new Date(Math.max(...allItems.map(item => item.timestamp.getTime())))
          : timeline.metadata.lastActivity,
      },
    };
    
    const endTime = performance.now();
    const mergeTime = endTime - startTime;
    
    // Log performance for ephemeral message merging (only if significant)
    if (mergeTime > 1) {
      console.debug('Timeline ephemeral merge performance', {
        timelineItems: timeline.items.length,
        ephemeralItems: ephemeralMessages.length,
        totalItems: result.items.length,
        mergeTimeMs: mergeTime.toFixed(3),
      });
    }
    
    return result;
  }, [timeline, ephemeralMessages]);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <TimelineDisplay
        timeline={finalTimeline}
        bottomSectionHeight={bottomSectionHeight}
        isTimelineLayoutDebugVisible={isTimelineLayoutDebugVisible}
      />
    </Box>
  );
}
