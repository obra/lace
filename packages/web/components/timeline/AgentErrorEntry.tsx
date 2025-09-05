// ABOUTME: Timeline entry component for AGENT_ERROR events
// ABOUTME: Renders error messages with proper styling and context

'use client';

import React from 'react';
import type { LaceEvent } from '@/types/core';
import { Alert } from '@/components/ui/Alert';

interface AgentErrorEntryProps {
  event: LaceEvent;
}

export function AgentErrorEntry({ event }: AgentErrorEntryProps) {
  const errorData = event.data as {
    errorType: string;
    message: string;
    isRetryable: boolean;
    context: {
      phase: string;
      providerName?: string;
      toolName?: string;
    };
  };

  const title =
    errorData.errorType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) + ' Error';

  const description = [
    errorData.message,
    `Phase: ${errorData.context.phase}`,
    errorData.context.providerName && `Provider: ${errorData.context.providerName}`,
    errorData.context.toolName && `Tool: ${errorData.context.toolName}`,
    errorData.isRetryable
      ? 'This error can be retried by sending another message.'
      : 'This error cannot be automatically retried.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return <Alert variant="error" title={title} description={description} />;
}
