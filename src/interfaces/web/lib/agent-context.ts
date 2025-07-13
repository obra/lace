// ABOUTME: Helper to extract Agent instance from Next.js request context
// ABOUTME: Provides type-safe access to Agent passed from main web interface

import type { Agent } from '~/agents/agent';
import type { LaceNextRequest } from '~/interfaces/web/types';

// Global agent instance shared across the web interface
// Use globalThis to ensure persistence across Next.js compilation contexts
declare global {
  var __laceAgent: Agent | undefined;
}

export function setSharedAgent(agent: Agent): void {
  globalThis.__laceAgent = agent;
}

export function getAgentFromRequest(request: LaceNextRequest): Agent {
  // First try to get agent from the Next.js request
  let agent = request.laceAgent;

  // If not found, fall back to the shared agent instance
  if (!agent && globalThis.__laceAgent) {
    agent = globalThis.__laceAgent;
  }

  if (!agent) {
    throw new Error(
      'Agent not available in request context. WebInterface must be running in integrated mode.'
    );
  }

  return agent;
}
