// ABOUTME: Simple approval types for tool execution without complex engine architecture
// ABOUTME: Provides ApprovalCallback interface and ApprovalDecision enum for clean tool approval

import { ToolCall } from '~/tools/types';

export enum ApprovalDecision {
  ALLOW_ONCE = 'allow_once',
  ALLOW_SESSION = 'allow_session',
  DENY = 'deny',
}

export interface ApprovalCallback {
  requestApproval(toolCall: ToolCall): Promise<ApprovalDecision>;
}

export class ApprovalPendingError extends Error {
  constructor(public readonly toolCallId: string) {
    super(`Tool approval pending for ${toolCallId}`);
    this.name = 'ApprovalPendingError';
  }
}
