// ABOUTME: Timeline entry component for AGENT_ERROR events
// ABOUTME: Renders error messages with proper styling and context

'use client';

import React from 'react';
import type { LaceEvent } from '@/types/core';
import { Alert } from '@/components/ui/Alert';

interface AgentErrorEntryProps {
  event: LaceEvent;
}

interface AgentErrorData {
  errorType: string;
  message: string;
  isRetryable: boolean;
  context: {
    phase: string;
    providerName?: string;
    toolName?: string;
  };
}

function isAgentErrorData(obj: unknown): obj is AgentErrorData {
  if (!obj || typeof obj !== 'object') return false;

  const data = obj as Record<string, unknown>;
  const context = data.context as Record<string, unknown>;

  return (
    typeof data.errorType === 'string' &&
    typeof data.message === 'string' &&
    typeof data.isRetryable === 'boolean' &&
    context &&
    typeof context === 'object' &&
    context !== null &&
    typeof context.phase === 'string'
  );
}

export function AgentErrorEntry({ event }: AgentErrorEntryProps) {
  if (!isAgentErrorData(event.data)) {
    // Malformed AGENT_ERROR event - return safe fallback
    return (
      <Alert variant="error" title="Error" description="Malformed error event data" style="soft" />
    );
  }

  const errorData = event.data;

  const title =
    errorData.errorType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) + ' Error';

  const lines = [
    errorData.message,
    `Phase: ${errorData.context.phase}`,
    errorData.context.providerName && `Provider: ${errorData.context.providerName}`,
    errorData.context.toolName && `Tool: ${errorData.context.toolName}`,
    errorData.isRetryable
      ? 'This error can be retried by sending another message.'
      : 'This error cannot be automatically retried.',
  ].filter(Boolean) as string[];

  return (
    <Alert variant="error" title={title} style="soft">
      <div className="space-y-2">
        {lines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </Alert>
  );
}
