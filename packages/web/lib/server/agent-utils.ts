// ABOUTME: Thin web integration layer for core approval system  
// ABOUTME: Sets up event-based approval callback from core tools system

import { Agent, EventApprovalCallback } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/core-types';

export function setupAgentApprovals(agent: Agent, _sessionId: ThreadId): void {
  // Use core event-based approval callback
  const approvalCallback = new EventApprovalCallback(
    agent,
    agent.threadManager,
    agent.threadId
  );
  
  // Set the approval callback on the agent's ToolExecutor
  agent.toolExecutor.setApprovalCallback(approvalCallback);
}
