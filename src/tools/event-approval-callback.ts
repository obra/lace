// ABOUTME: Event-based approval callback that uses ThreadManager for persistence
// ABOUTME: Replaces Promise-based approval system with durable event storage

import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { Agent } from '~/agents/agent';
import { ToolCall } from '~/tools/types';
import { ThreadEvent } from '~/threads/types';

export class EventApprovalCallback implements ApprovalCallback {
  constructor(
    private agent: Agent
  ) {}

  requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // Find the TOOL_CALL event that triggered this approval
    const toolCallEvent = this.findRecentToolCallEvent(toolName, input);
    if (!toolCallEvent) {
      throw new Error(`Could not find TOOL_CALL event for ${toolName}`);
    }

    const toolCallId = (toolCallEvent.data as ToolCall).id;

    // Check if approval response already exists (recovery case)
    const existingResponse = this.checkExistingApprovalResponse(toolCallId);
    if (existingResponse) {
      return Promise.resolve(existingResponse);
    }

    // Check if approval request already exists to avoid duplicates
    const existingRequest = this.checkExistingApprovalRequest(toolCallId);
    if (!existingRequest) {
      // Create TOOL_APPROVAL_REQUEST event and emit it so SSE stream can deliver it
      this.agent.addApprovalRequestEvent(toolCallId);
    }

    // Instead of blocking, return a rejected promise with pending error
    // The Agent will handle this by NOT executing the tool yet
    return Promise.reject(new ApprovalPendingError(toolCallId));
  }

  private findRecentToolCallEvent(toolName: string, input: unknown): ThreadEvent | null {
    return this.agent.findRecentToolCallEvent(toolName, input);
  }

  private checkExistingApprovalRequest(toolCallId: string): boolean {
    return this.agent.checkExistingApprovalRequest(toolCallId);
  }

  private checkExistingApprovalResponse(toolCallId: string): ApprovalDecision | null {
    return this.agent.checkExistingApprovalResponse(toolCallId);
  }
}
