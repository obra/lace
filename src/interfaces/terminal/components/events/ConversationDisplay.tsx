// ABOUTME: Performance-optimized conversation display using ThreadProcessor with caching  
// ABOUTME: Processes thread events only when changed, ephemeral messages on every render

import React, { useMemo, useRef } from 'react';
import { Box } from 'ink';
import { ThreadEvent } from '../../../../threads/types.js';
import { ThreadProcessor, Timeline } from '../../../thread-processor.js';
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
  const processorRef = useRef<ThreadProcessor | undefined>(undefined);
  const eventsHashRef = useRef<string | undefined>(undefined);
  const processedEventsRef = useRef<any>(undefined);

  // Initialize processor if needed
  if (!processorRef.current) {
    processorRef.current = new ThreadProcessor();
  }

  // Cache events processing - only reprocess when events change
  const processedEvents = useMemo(() => {
    const eventsHash = JSON.stringify(events.map(e => ({ id: e.id, type: e.type, timestamp: e.timestamp })));
    
    if (eventsHashRef.current === eventsHash && processedEventsRef.current) {
      return processedEventsRef.current;
    }
    
    eventsHashRef.current = eventsHash;
    const processed = processorRef.current!.processEvents(events);
    processedEventsRef.current = processed;
    return processed;
  }, [events]);

  // Process ephemeral messages on every render (frequent updates during streaming)
  const ephemeralItems = useMemo(() => {
    return processorRef.current!.processEphemeralEvents(ephemeralMessages);
  }, [ephemeralMessages]);

  // Build final timeline 
  const timeline: Timeline = useMemo(() => {
    return processorRef.current!.buildTimeline(processedEvents, ephemeralItems);
  }, [processedEvents, ephemeralItems]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingY={1}>
      <TimelineDisplay timeline={timeline} />
    </Box>
  );
}