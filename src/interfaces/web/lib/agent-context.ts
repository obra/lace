// ABOUTME: Helper to extract Agent instance from Next.js request context
// ABOUTME: Provides type-safe access to Agent passed from main web interface

import type { NextRequest } from 'next/server';
import type { Agent } from '~/agents/agent';

export function getAgentFromRequest(request: NextRequest): Agent {
  const agent = (request as any).laceAgent as Agent | undefined;

  if (!agent) {
    throw new Error(
      'Agent not available in request context. WebInterface must be running in integrated mode.'
    );
  }

  return agent;
}
