// ABOUTME: Server-side approval manager for handling tool approval requests
// ABOUTME: Manages pending approvals, timeouts, and decision resolution

import { randomUUID } from 'crypto';
import { ThreadId, SessionEvent, ToolApprovalRequestData } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';
import { ApprovalDecision, type ToolAnnotations } from '@/lib/server/lace-imports';

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  threadId: ThreadId;
  toolName: string;
  sessionId: ThreadId;
}

class ApprovalManager {
  private pendingApprovals = new Map<string, PendingApproval>();
  private sessionApprovals = new Map<ThreadId, Set<string>>(); // Track session-wide approvals

  async requestApproval(
    threadId: ThreadId,
    sessionId: ThreadId,
    toolName: string,
    toolDescription: string | undefined,
    toolAnnotations: ToolAnnotations | undefined,
    input: unknown,
    isReadOnly: boolean,
    timeoutMs: number = 30000
  ): Promise<ApprovalDecision> {
    // Check if already approved for session
    const sessionApproved = this.sessionApprovals.get(sessionId);
    if (sessionApproved?.has(toolName)) {
      console.warn(`Tool ${toolName} already approved for session ${sessionId}`);
      return ApprovalDecision.ALLOW_SESSION;
    }

    const requestId = randomUUID();

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        console.error(`Approval request ${requestId} timed out`);
        reject(new Error('Approval request timed out'));
      }, timeoutMs);

      // Store pending approval
      this.pendingApprovals.set(requestId, {
        resolve,
        reject,
        timeout,
        threadId,
        toolName,
        sessionId,
      });

      // Emit SSE event with full tool information
      const approvalData: ToolApprovalRequestData = {
        requestId,
        toolName,
        input,
        isReadOnly,
        ...(toolDescription && { toolDescription }),
        ...(toolAnnotations && { toolAnnotations }),
        riskLevel: this.getRiskLevel(toolName, isReadOnly, toolAnnotations),
        timeout: Math.floor(timeoutMs / 1000),
      };

      const event: SessionEvent = {
        type: 'TOOL_APPROVAL_REQUEST',
        threadId,
        timestamp: new Date(),
        data: approvalData,
      };

      SSEManager.getInstance().broadcast(sessionId, event);
    });
  }

  resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      console.warn(`No pending approval found for ${requestId}`);
      return false;
    }

    clearTimeout(pending.timeout);

    // Handle session-wide approvals
    if (decision === ApprovalDecision.ALLOW_SESSION) {
      if (!this.sessionApprovals.has(pending.sessionId)) {
        this.sessionApprovals.set(pending.sessionId, new Set());
      }
      this.sessionApprovals.get(pending.sessionId)!.add(pending.toolName);
      console.warn(
        `Added session-wide approval for ${pending.toolName} in session ${pending.sessionId}`
      );
    }

    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);
    console.warn(`Resolved approval ${requestId} with decision: ${decision}`);
    return true;
  }

  clearSessionApprovals(sessionId: ThreadId): void {
    this.sessionApprovals.delete(sessionId);
    // Also clear any pending approvals for this session
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Session ended'));
        this.pendingApprovals.delete(requestId);
      }
    }
  }

  private getRiskLevel(
    toolName: string,
    isReadOnly: boolean,
    annotations?: ToolAnnotations
  ): 'safe' | 'moderate' | 'destructive' {
    // Check annotations first
    if (annotations?.safeInternal || annotations?.readOnlyHint || isReadOnly) {
      return 'safe';
    }

    if (annotations?.destructiveHint) {
      return 'destructive';
    }

    // Tool-specific risk assessment
    const safeTools = ['task-create', 'task-update', 'task-complete'];
    const moderateTools = ['file-write', 'file-edit', 'file-insert'];
    const destructiveTools = ['bash', 'delegate'];

    if (safeTools.includes(toolName)) return 'safe';
    if (destructiveTools.includes(toolName)) return 'destructive';
    if (moderateTools.includes(toolName)) return 'moderate';

    // Default to moderate for unknown tools
    return 'moderate';
  }

  getStats() {
    return {
      pendingCount: this.pendingApprovals.size,
      sessionApprovalsCount: this.sessionApprovals.size,
      sessions: Array.from(this.sessionApprovals.entries()).map(([sessionId, tools]) => ({
        sessionId,
        approvedTools: Array.from(tools),
      })),
    };
  }
}

// Use global to persist across HMR in development
declare global {
  var approvalManager: ApprovalManager | undefined;
}

export function getApprovalManager(): ApprovalManager {
  if (!global.approvalManager) {
    global.approvalManager = new ApprovalManager();
  }
  return global.approvalManager;
}
