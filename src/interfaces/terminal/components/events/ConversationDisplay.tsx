// ABOUTME: Performance-optimized conversation display using ThreadProcessor with caching  
// ABOUTME: Processes thread events only when changed, ephemeral messages on every render

import React, { useMemo, useRef } from 'react';
import { Box } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { ThreadProcessor, Timeline, ProcessedThreads } from '../../../thread-processor.js';
import { useThreadProcessor } from '../../terminal-interface.js';
import TimelineDisplay from './TimelineDisplay.js';

interface Message {
  type: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  timestamp: Date;
}

interface ConversationDisplayProps {
  events: ThreadEvent[];
  ephemeralMessages: Message[];
}

export function ConversationDisplay({ events, ephemeralMessages }: ConversationDisplayProps) {
  // Use shared ThreadProcessor from context
  const threadProcessor = useThreadProcessor();

  // Process all threads
  const processedThreads = useMemo(() => {
    return threadProcessor.processThreads(events);
  }, [events, threadProcessor]);

  // Process ephemeral messages (main thread only)
  const ephemeralItems = useMemo(() => {
    return threadProcessor.processEphemeralEvents(ephemeralMessages);
  }, [ephemeralMessages, threadProcessor]);

  // Build main timeline with ephemeral messages
  const mainTimeline = useMemo(() => {
    return threadProcessor.buildTimeline(
      processedThreads.mainTimeline.items as any,
      ephemeralItems
    );
  }, [processedThreads.mainTimeline, ephemeralItems, threadProcessor]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingY={1}>
      <TimelineDisplay 
        timeline={mainTimeline} 
        delegateTimelines={processedThreads.delegateTimelines}
      />
    </Box>
  );
}