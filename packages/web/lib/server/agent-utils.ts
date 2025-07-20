// ABOUTME: Utilities for agent-specific web concerns
// ABOUTME: Handles tool approval and SSE setup for individual agents

import { Agent, ApprovalDecision } from '@/lib/server/lace-imports';
import { asThreadId, type ThreadId } from '@/lib/server/core-types';
import { getApprovalManager } from '@/lib/server/approval-manager';

export function setupAgentApprovals(agent: Agent, sessionId: ThreadId): void {
  // Create ApprovalCallback implementation that emits events (like CLI)
  const approvalCallback = {
    async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
      const tool = agent.toolExecutor?.getTool(toolName);
      const isReadOnly = tool?.annotations?.readOnlyHint === true;

      return new Promise<ApprovalDecision>((resolve) => {
        const requestId = `${toolName}-${Date.now()}`;

        // Emit event for SessionService to handle
        agent.emit('approval_request', {
          toolName,
          input,
          isReadOnly,
          requestId,
          resolve,
        });
      });
    },
  };

  // Set the approval callback on the agent's ToolExecutor
  agent.toolExecutor.setApprovalCallback(approvalCallback);
}
