// ABOUTME: Event-based approval callback that works directly with ToolCall IDs
// ABOUTME: Replaces Promise-based approval system with durable event storage

import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { ToolCall } from '~/tools/types';
import { Agent } from '~/agents/agent';

export class EventApprovalCallback implements ApprovalCallback {
  constructor(private agent: Agent) {}

  requestApproval(toolCall: ToolCall): Promise<ApprovalDecision> {
    // Check if approval response already exists (recovery case)
    const existingResponse = this.checkExistingApprovalResponse(toolCall.id);
    if (existingResponse) {
      return Promise.resolve(existingResponse);
    }

    // Check if approval request already exists to avoid duplicates
    const existingRequest = this.checkExistingApprovalRequest(toolCall.id);
    if (!existingRequest) {
      // Create TOOL_APPROVAL_REQUEST event and emit it so SSE stream can deliver it
      this.agent.addApprovalRequestEvent(toolCall.id);
    }

    // Instead of blocking, return a rejected promise with pending error
    // The Agent will handle this by NOT executing the tool yet
    return Promise.reject(new ApprovalPendingError(toolCall.id));
  }

  private checkExistingApprovalRequest(toolCallId: string): boolean {
    return this.agent.checkExistingApprovalRequest(toolCallId);
  }

  private checkExistingApprovalResponse(toolCallId: string): ApprovalDecision | null {
    return this.agent.checkExistingApprovalResponse(toolCallId);
  }
}
