// ABOUTME: Simple approval types for tool execution without complex engine architecture
// ABOUTME: Provides ApprovalCallback interface and ApprovalDecision enum for clean tool approval

export enum ApprovalDecision {
  ALLOW_ONCE = 'allow_once',
  ALLOW_SESSION = 'allow_session',
  DENY = 'deny',
}

export interface ApprovalCallback {
  requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision>;
}
