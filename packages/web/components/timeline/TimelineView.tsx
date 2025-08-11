// ABOUTME: Timeline view component that renders LaceEvents directly
// ABOUTME: Replaces TimelineView to work with unified event system

'use client';

import { useEffect, useRef } from 'react';
import type { LaceEvent, AgentInfo, ThreadId } from '@/types/core';
import { asThreadId } from '@/types/core';
import { TimelineMessage } from './TimelineMessage';
import { TypingIndicator } from './TypingIndicator';
import { useProcessedEvents } from '@/hooks/useProcessedEvents';

interface TimelineViewProps {
  events: LaceEvent[];
  agents?: AgentInfo[];
  isTyping: boolean;
  currentAgent: string;
  streamingContent?: string;
  selectedAgent?: string;
}

export function TimelineView({
  events,
  agents,
  isTyping,
  currentAgent,
  streamingContent,
  selectedAgent,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Process events (filtering, aggregation, etc.)
  const processedEvents = useProcessedEvents(events, selectedAgent ? asThreadId(selectedAgent) : undefined);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [processedEvents, isTyping, streamingContent]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain">
      <div className="p-4 space-y-4 pb-32">
        {processedEvents.length === 0 && (
          <div className="text-gray-400 text-center py-8">
            No conversation data loaded. {processedEvents.length} events.
          </div>
        )}
        
        {processedEvents.map((event, index) => (
          <TimelineMessage 
            key={event.id || `${event.threadId}-${event.timestamp}-${index}`} 
            event={event} 
            agents={agents}
          />
        ))}

        {streamingContent && (
          <TimelineMessage
            event={{
              id: 'streaming',
              type: 'AGENT_STREAMING',
              threadId: currentAgent ? asThreadId(currentAgent) : asThreadId(''),
              timestamp: new Date(),
              data: { content: streamingContent },
              transient: true,
            }}
            agents={agents}
          />
        )}

        {isTyping && !streamingContent && <TypingIndicator agent={currentAgent} />}
      </div>
    </div>
  );
}