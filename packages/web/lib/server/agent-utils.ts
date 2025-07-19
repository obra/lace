// ABOUTME: Utilities for agent-specific web concerns
// ABOUTME: Handles tool approval and SSE setup for individual agents

import { Agent } from '@/lib/server/lace-imports';
import { ThreadId } from '@/lib/server/core-types';
import { getApprovalManager } from './approval-manager';

export function setupAgentApprovals(agent: Agent, sessionId: ThreadId): void {
  const approvalManager = getApprovalManager();

  agent.on('approval_request', async ({ toolName, input, callback }) => {
    try {
      const decision = await approvalManager.requestApproval(
        agent.threadId,
        sessionId,
        toolName,
        'Tool execution request',
        undefined, // annotations
        input,
        false // isReadOnly
      );
      callback(decision);
    } catch (error) {
      callback('deny');
    }
  });
}
