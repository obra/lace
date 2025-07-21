// ABOUTME: Design system message list component for conversation event management
// ABOUTME: Handles event processing, filtering, streaming, and chronological display

import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import type { SessionEvent, Agent, ThreadId } from '@/types/api';
import { LaceMessageDisplay } from './LaceMessageDisplay';
import LoadingDots from '@/components/ui/LoadingDots';
import SkeletonLoader from '@/components/ui/SkeletonLoader';

interface LaceMessageListProps {
  events: SessionEvent[];
  agents: Agent[];
  selectedAgent?: ThreadId;
  className?: string;
  isLoading?: boolean;
}

export function LaceMessageList({
  events,
  agents,
  selectedAgent,
  className = '',
  isLoading = false,
}: LaceMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter events by selected agent if provided
  const filteredEvents = useMemo(() => {
    if (!selectedAgent) return events;

    // Include events from the selected agent and USER_MESSAGE events sent to that agent
    return events.filter((event) => {
      // Always include user messages directed to the selected agent
      if (event.type === 'USER_MESSAGE' && event.threadId === selectedAgent) {
        return true;
      }

      // Include all other events from the selected agent
      return event.threadId === selectedAgent;
    });
  }, [events, selectedAgent]);

  // Process events to merge streaming tokens into complete messages
  const processedEvents = useMemo(() => {
    const processed: SessionEvent[] = [];
    const streamingMessages = new Map<string, { content: string; timestamp: string }>();
    const MAX_STREAMING_MESSAGES = 100; // Prevent unbounded growth

    for (const event of filteredEvents) {
      if (event.type === 'AGENT_TOKEN') {
        // Accumulate streaming tokens
        const key = `${event.threadId}-streaming`;
        const existing = streamingMessages.get(key);
        if (existing) {
          existing.content += event.data.token;
        } else {
          // Limit map size to prevent memory issues
          if (streamingMessages.size >= MAX_STREAMING_MESSAGES) {
            // Remove oldest entry
            const firstKey = streamingMessages.keys().next().value;
            if (firstKey) streamingMessages.delete(firstKey);
          }
          streamingMessages.set(key, {
            content: event.data.token,
            timestamp: event.timestamp,
          });
        }
      } else if (event.type === 'AGENT_MESSAGE') {
        // Complete message received, remove streaming version
        const key = `${event.threadId}-streaming`;
        streamingMessages.delete(key);
        processed.push(event);
      } else {
        processed.push(event);
      }
    }

    // Add any remaining streaming messages
    for (const [key, streamingData] of streamingMessages.entries()) {
      const threadId = key.replace('-streaming', '');
      processed.push({
        type: 'AGENT_STREAMING',
        threadId: threadId as ThreadId,
        timestamp: streamingData.timestamp,
        data: { content: streamingData.content },
      } as SessionEvent);
    }

    return processed;
  }, [filteredEvents]);

  // Helper to find agent by threadId
  const getAgentByThreadId = useCallback(
    (threadId: ThreadId): Agent | undefined => {
      return agents.find((agent) => agent.threadId === threadId);
    },
    [agents]
  );

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const isScrolledToBottom = 
        container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
      
      if (isScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [processedEvents]);

  // Loading skeleton component
  const LoadingSkeleton = () => (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center space-x-2">
            <SkeletonLoader className="w-20 h-4" />
            <SkeletonLoader className="w-32 h-4" />
          </div>
          <div className="space-y-2 ml-4">
            <SkeletonLoader className="h-4 w-full max-w-md" />
            <SkeletonLoader className="h-4 w-3/4 max-w-md" />
            <SkeletonLoader className="h-4 w-1/2 max-w-md" />
          </div>
        </div>
      ))}
    </div>
  );

  // Empty state component
  const EmptyState = () => (
    <div className="text-gray-500 text-center py-8">
      <div className="text-lg font-medium mb-2">No messages yet</div>
      <div className="text-sm">Start a conversation!</div>
    </div>
  );

  return (
    <div 
      ref={containerRef}
      className={`bg-gray-900 rounded-lg p-4 overflow-y-auto ${className}`}
    >
      {isLoading ? (
        <LoadingSkeleton />
      ) : processedEvents.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-1">
          {processedEvents.map((event, index) => {
            const agent = getAgentByThreadId(event.threadId);
            const isStreaming = event.type === 'AGENT_STREAMING';
            
            return (
              <LaceMessageDisplay
                key={`${event.threadId}-${event.timestamp}-${index}`}
                event={event}
                agent={agent}
                isStreaming={isStreaming}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}