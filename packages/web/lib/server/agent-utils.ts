// ABOUTME: Utilities for agent-specific web concerns
// ABOUTME: Handles tool approval and SSE setup for individual agents

import { Agent } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/core-types';
import { getApprovalManager } from '@/lib/server/approval-manager';

export function setupAgentApprovals(agent: Agent, sessionId: ThreadId): void {
  const approvalManager = getApprovalManager();

  agent.on(
    'approval_request',
    async ({
      toolName,
      input,
      callback,
    }: {
      toolName: string;
      input: unknown;
      callback: (decision: string) => void;
    }) => {
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
      } catch (_error) {
        callback('deny');
      }
    }
  );
}
