// ABOUTME: Wrapper component that adds JSON details toggle to TimelineMessage
// ABOUTME: Shows raw event data for debugging and transparency

'use client';

import type { ProcessedEvent } from '@/hooks/useProcessedEvents';
import type { AgentInfo } from '@/types/core';
import { TimelineMessage } from './TimelineMessage';
import { TechnicalDetailsToggle } from '@/components/ui/TechnicalDetailsToggle';

interface TimelineMessageWithDetailsProps {
  event: ProcessedEvent;
  agents?: AgentInfo[];
}

export function TimelineMessageWithDetails({ event, agents }: TimelineMessageWithDetailsProps) {
  return (
    <TechnicalDetailsToggle 
      details={event}
      label="Event Details"
      className="relative"
      buttonClassName="absolute top-2 right-2 text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200"
    >
      <TimelineMessage event={event} agents={agents} />
    </TechnicalDetailsToggle>
  );
}