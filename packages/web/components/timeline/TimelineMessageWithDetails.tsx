// ABOUTME: Wrapper component that adds JSON details toggle to TimelineMessage
// ABOUTME: Shows raw event data for debugging and transparency

'use client';

import React from 'react';
import type { ProcessedEvent } from '@/hooks/useProcessedEvents';
import type { AgentInfo } from '@/types/core';
import { TimelineMessage } from './TimelineMessage';
import { TechnicalDetailsToggle } from '@/components/ui/TechnicalDetailsToggle';

interface TimelineMessageWithDetailsProps {
  event: ProcessedEvent;
  agents?: AgentInfo[];
  isGrouped?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
}

export function TimelineMessageWithDetails({
  event,
  agents,
  isGrouped,
  isFirstInGroup,
  isLastInGroup,
}: TimelineMessageWithDetailsProps) {
  return (
    <TechnicalDetailsToggle details={event} label="Event Details">
      <TimelineMessage
        event={event}
        agents={agents}
        isGrouped={isGrouped}
        isFirstInGroup={isFirstInGroup}
        isLastInGroup={isLastInGroup}
      />
    </TechnicalDetailsToggle>
  );
}
