// ABOUTME: Event-based approval callback that uses ThreadManager for persistence
// ABOUTME: Replaces Promise-based approval system with durable event storage

import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types';
import { ThreadManager } from '~/threads/thread-manager';
import { Agent } from '~/agents/agent';
import { ToolCall } from '~/tools/types';
import { ThreadEvent, ToolApprovalRequestData, ToolApprovalResponseData } from '~/threads/types';
import { isDeepStrictEqual } from 'util';

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
      // Create TOOL_APPROVAL_REQUEST event and emit it so SSE stream can deliver it
      const event = this.threadManager.addEvent(this.threadId, 'TOOL_APPROVAL_REQUEST', {
        toolCallId: toolCallId,
      });

      // Emit the event so the SSE stream delivers it to the frontend immediately
      this.agent.emit('thread_event_added', { event, threadId: this.threadId });
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
        if (toolCall.name === toolName && isDeepStrictEqual(toolCall.arguments, input)) {
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

      // Listen for thread_event_added events on Agent
      const eventListener = (data: { event: ThreadEvent; threadId: string }) => {
        const { event } = data;
        if (
          event.type === 'TOOL_APPROVAL_RESPONSE' &&
          (event.data as ToolApprovalResponseData).toolCallId === toolCallId
        ) {
          this.agent.off('thread_event_added', eventListener);
          resolve((event.data as ToolApprovalResponseData).decision);
        }
      };

      this.agent.on('thread_event_added', eventListener);

      // No timeout - wait indefinitely for user approval
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
