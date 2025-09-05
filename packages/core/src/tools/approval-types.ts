// ABOUTME: Simple approval types for tool execution without complex engine architecture
// ABOUTME: Provides ApprovalCallback interface and ApprovalDecision enum for clean tool approval

import { ToolCall } from '~/tools/types';

export enum ApprovalDecision {
  ALLOW_ONCE = 'allow_once',
  ALLOW_SESSION = 'allow_session',
  ALLOW_PROJECT = 'allow_project', // NEW - for MCP tools
  ALLOW_ALWAYS = 'allow_always', // NEW - for MCP tools
  DENY = 'deny',
  DISABLE = 'disable', // NEW - tool won't appear in lists
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

export type ToolPolicy = 'allow' | 'require-approval' | 'deny';
