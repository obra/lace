// ABOUTME: Thin web integration layer for core approval system
// ABOUTME: Sets up event-based approval callback from core tools system

import { Agent, EventApprovalCallback } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/types/core';

export function setupAgentApprovals(agent: Agent, _sessionId: ThreadId): void {
  // Use core event-based approval callback
  const approvalCallback = new EventApprovalCallback(agent);

  // Set the approval callback on the agent's ToolExecutor
  agent.toolExecutor.setApprovalCallback(approvalCallback);
}
