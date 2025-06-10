// ABOUTME: TypeScript type definitions for tool approval safety subsystem
// ABOUTME: Clean interfaces for approval requests, results, and user decisions

export interface ToolCall {
  name: string;
  input: Record<string, any>;
  description?: string;
}

export interface ApprovalRequest {
  toolCall: ToolCall;
  context?: {
    reasoning?: string;
    sessionId?: string;
  };
}

export interface ApprovalResult {
  approved: boolean;
  reason: string;
  modifiedCall?: ToolCall | null;
  shouldStop?: boolean;
  postExecutionComment?: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface UserDecision {
  action: "approve" | "deny" | "stop";
  toolCall: ToolCall;
  modifiedCall?: ToolCall;
  comment?: string;
  reason?: string;
}

export interface ApprovalEngineConfig {
  autoApproveTools?: string[];
  alwaysDenyTools?: string[];
  interactive?: boolean;
  activityLogger?: any;
}

export interface ApprovalStatus {
  interactive: boolean;
  autoApprove: string[];
  denyList: string[];
}
