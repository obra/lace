// ABOUTME: Event-based approval callback that uses ThreadManager for persistence
// ABOUTME: Replaces Promise-based approval system with durable event storage

import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types';
import { ThreadManager } from '~/threads/thread-manager';
import { Agent } from '~/agents/agent';
import { ToolCall } from '~/tools/types';
import { ThreadEvent, ToolApprovalRequestData, ToolApprovalResponseData } from '~/threads/types';

export class EventApprovalCallback implements ApprovalCallback {
  constructor(
    private agent: Agent,
    private threadManager: ThreadManager,
    private threadId: string
  ) {}

  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // Find the TOOL_CALL event that triggered this approval
    const toolCallEvent = this.findRecentToolCallEvent(toolName, input);
    if (!toolCallEvent) {
      throw new Error(`Could not find TOOL_CALL event for ${toolName}`);
    }

    const toolCallId = (toolCallEvent.data as ToolCall).id;

    // Check if approval response already exists (recovery case)
    const existingResponse = this.checkExistingApprovalResponse(toolCallId);
    if (existingResponse) {
      return existingResponse;
    }

    // Check if approval request already exists to avoid duplicates
    const existingRequest = this.checkExistingApprovalRequest(toolCallId);
    if (!existingRequest) {
      // Create TOOL_APPROVAL_REQUEST event only if it doesn't exist
      this.threadManager.addEvent(this.threadId, 'TOOL_APPROVAL_REQUEST', {
        toolCallId: toolCallId,
      });
    }

    // Wait for TOOL_APPROVAL_RESPONSE event
    return this.waitForApprovalResponse(toolCallId);
  }

  private findRecentToolCallEvent(toolName: string, input: unknown): ThreadEvent | null {
    const events = this.threadManager.getEvents(this.threadId);

    // Find most recent TOOL_CALL for this tool with matching input
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.type === 'TOOL_CALL') {
        const toolCall = event.data as ToolCall;
        if (
          toolCall.name === toolName &&
          JSON.stringify(toolCall.arguments) === JSON.stringify(input)
        ) {
          return event;
        }
      }
    }
    return null;
  }

  private waitForApprovalResponse(toolCallId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      // Check if response already exists (recovery case)
      const existingResponse = this.checkExistingApprovalResponse(toolCallId);
      if (existingResponse) {
        resolve(existingResponse);
        return;
      }

      // Poll for approval response (temporary approach until event emission is added)
      const pollInterval = setInterval(() => {
        const response = this.checkExistingApprovalResponse(toolCallId);
        if (response) {
          clearInterval(pollInterval);
          resolve(response);
        }
      }, 100); // Poll every 100ms

      // Set a reasonable timeout
      setTimeout(() => {
        clearInterval(pollInterval);
        // For testing purposes, we'll throw an error instead of hanging
        // In real usage, this would continue polling
        const finalCheck = this.checkExistingApprovalResponse(toolCallId);
        if (finalCheck) {
          resolve(finalCheck);
        } else {
          // This is a timeout - in real usage we might continue or handle differently
          throw new Error(`Approval timeout for tool call ${toolCallId}`);
        }
      }, 10000); // 10 second timeout for tests
    });
  }

  private checkExistingApprovalRequest(toolCallId: string): boolean {
    const events = this.threadManager.getEvents(this.threadId);
    return events.some(
      (e) =>
        e.type === 'TOOL_APPROVAL_REQUEST' &&
        (e.data as ToolApprovalRequestData).toolCallId === toolCallId
    );
  }

  private checkExistingApprovalResponse(toolCallId: string): ApprovalDecision | null {
    const events = this.threadManager.getEvents(this.threadId);
    const responseEvent = events.find(
      (e) =>
        e.type === 'TOOL_APPROVAL_RESPONSE' &&
        (e.data as ToolApprovalResponseData).toolCallId === toolCallId
    );
    return responseEvent ? (responseEvent.data as ToolApprovalResponseData).decision : null;
  }
}
