// ABOUTME: Timeline view component that renders LaceEvents directly
// ABOUTME: Replaces TimelineView to work with unified event system

'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { LaceEvent, AgentInfo, ThreadId } from '@/types/core';
import type { CompactionState } from '@/components/providers/EventStreamProvider';
import { asThreadId } from '@/types/core';
import { TimelineMessageWithDetails } from './TimelineMessageWithDetails';
import { TypingIndicator } from './TypingIndicator';
import { CompactionIndicator } from './CompactionIndicator';
import { useProcessedEvents } from '@/hooks/useProcessedEvents';
import TimelineEntryErrorBoundary from './TimelineEntryErrorBoundary';

// Placeholder for when currentAgent is not available - use valid thread ID format
const STREAMING_THREAD_ID = asThreadId('lace_19700101_stream');

interface TimelineViewProps {
  events: LaceEvent[];
  agents?: AgentInfo[];
  isTyping: boolean;
  currentAgent?: string;
  selectedAgent?: string;
  compactionState?: CompactionState;
}

export function TimelineView({
  events,
  agents,
  isTyping,
  currentAgent,
  selectedAgent,
  compactionState,
}: TimelineViewProps) {
  // Process events (filtering, aggregation, etc.)
  const processedEvents = useProcessedEvents(
    events,
    selectedAgent ? asThreadId(selectedAgent) : undefined
  );

  return (
    <div className="h-full overscroll-contain scroll-smooth">
      <div className="min-h-full flex flex-col justify-end">
        <div className="p-4 space-y-4 pb-32">
          {processedEvents.length === 0 && (
            <div className="text-gray-400 text-center py-8">
              No conversation data loaded. {processedEvents.length} events.
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {processedEvents.map((event, index) => {
              // Determine if this message should be grouped with previous message
              const prevEvent = index > 0 ? processedEvents[index - 1] : null;
              const nextEvent =
                index < processedEvents.length - 1 ? processedEvents[index + 1] : null;

              // Group messages from same sender that are close in time and type
              const shouldGroupWithPrevious =
                prevEvent &&
                prevEvent.type === event.type &&
                prevEvent.threadId === event.threadId &&
                ['USER_MESSAGE', 'AGENT_MESSAGE', 'AGENT_STREAMING'].includes(event.type) &&
                ['USER_MESSAGE', 'AGENT_MESSAGE', 'AGENT_STREAMING'].includes(prevEvent.type);

              const shouldGroupWithNext =
                nextEvent &&
                nextEvent.type === event.type &&
                nextEvent.threadId === event.threadId &&
                ['USER_MESSAGE', 'AGENT_MESSAGE', 'AGENT_STREAMING'].includes(event.type) &&
                ['USER_MESSAGE', 'AGENT_MESSAGE', 'AGENT_STREAMING'].includes(nextEvent.type);

              return (
                <motion.div
                  key={event.id || `${event.threadId}-${event.timestamp}-${index}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{
                    duration: 0.15,
                    ease: 'easeOut',
                    layout: { duration: 0.1 },
                  }}
                  layout
                >
                  <TimelineEntryErrorBoundary event={event}>
                    <TimelineMessageWithDetails
                      event={event}
                      agents={agents}
                      isGrouped={!!shouldGroupWithPrevious}
                      isLastInGroup={!shouldGroupWithNext}
                      isFirstInGroup={!shouldGroupWithPrevious}
                    />
                  </TimelineEntryErrorBoundary>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <AnimatePresence>
            {isTyping && currentAgent && (
              <motion.div
                key="typing"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
              >
                <TypingIndicator agent={currentAgent} />
              </motion.div>
            )}

            {compactionState?.isCompacting && (
              <motion.div
                key="compacting"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
              >
                <CompactionIndicator compactionState={compactionState} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
