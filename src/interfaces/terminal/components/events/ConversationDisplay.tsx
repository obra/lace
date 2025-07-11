// ABOUTME: O(1) conversation display using StreamingTimelineProcessor for optimal performance
// ABOUTME: Eliminates O(n) reprocessing by using incremental timeline updates

import React, { useMemo } from 'react';
import { Box } from 'ink';
import { EphemeralMessage } from '~/interfaces/timeline-types.js';
import { useStreamingTimelineProcessor } from '~/interfaces/terminal/terminal-interface.js';
import TimelineDisplay from '~/interfaces/terminal/components/events/TimelineDisplay.js';

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
    const result = streamingProcessor.getTimeline();

    // Performance monitoring removed to eliminate render overhead

    return result;
  }, [streamingProcessor, timelineVersion]);

  // Convert ephemeral messages to EphemeralMessage format and merge into timeline
  const finalTimeline = useMemo(() => {
    if (ephemeralMessages.length === 0) {
      return timeline;
    }

    // Convert Message[] to EphemeralMessage[] format
    const ephemeralItems: EphemeralMessage[] = ephemeralMessages.map((msg) => ({
      type: msg.type,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    // Create ephemeral timeline items
    const ephemeralTimelineItems = ephemeralItems.map((msg) => ({
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
        lastActivity:
          allItems.length > 0
            ? new Date(Math.max(...allItems.map((item) => item.timestamp.getTime())))
            : timeline.metadata.lastActivity,
      },
    };

    // Performance monitoring removed to eliminate render overhead

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
