// ABOUTME: Shared approval route handler functions for session and thread scoped approval routes
// ABOUTME: Abstracts scope differences to reduce duplication across route files

import { z } from 'zod';
import type { PendingPermission } from '@lace/supervisor';
import type { PendingApproval, SessionPendingApproval } from '@lace/web/types/api';
import {
  getSupervisor,
  listPendingPermissions,
  resolvePendingPermission,
} from '@lace/web/lib/server/supervisor-service';
import { RouteValidationError } from './route-helpers';

// ============================================================================
// Types
// ============================================================================

/**
 * Approval scope determines how approvals are looked up and resolved.
 * - 'session': Works with workspaceSessionId, returns ALL pending approvals for the session
 * - 'thread': Works with threadId (agentSessionId), returns only that agent's pending approvals
 */
export type ApprovalScope = 'session' | 'thread';

/**
 * Context for approval route operations.
 * One of workspaceSessionId or threadId must be provided based on scope.
 */
export interface ApprovalContext {
  scope: ApprovalScope;
  workspaceSessionId?: string; // Required for session scope
  threadId?: string; // Required for thread scope (agentSessionId)
}

/**
 * Result from submitting an approval decision.
 */
export interface ApprovalDecisionResult {
  success: boolean;
  toolCallId: string;
  decision: string;
}

// ============================================================================
// Shared Zod Schema
// ============================================================================

/**
 * Schema for approval decision request body.
 * Used by both session and thread decision routes.
 */
export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['allow_once', 'allow_session', 'deny'], {
    errorMap: () => ({ message: 'Decision must be "allow_once", "allow_session", or "deny"' }),
  }),
});

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>['decision'];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform a PendingPermission from the supervisor into the API response format.
 *
 * @param pending - The pending permission from supervisor
 * @param includeAgentId - Whether to include agentId in the response (session scope includes it, thread scope does not)
 * @returns The transformed approval object
 */
export function transformPendingApproval(
  pending: PendingPermission,
  includeAgentId?: boolean
): PendingApproval & { agentId?: string } {
  // Prefer toolCall.name, fall back to request.tool
  const toolName =
    typeof pending.toolCall?.name === 'string'
      ? pending.toolCall.name
      : typeof pending.request.tool === 'string'
        ? pending.request.tool
        : '';

  const toolCall = {
    name: toolName,
    arguments: pending.toolCall?.arguments ?? {},
  };

  const base: PendingApproval = {
    toolCallId: pending.toolCallId,
    toolCall,
    requestedAt: new Date(pending.requestedAt),
    requestData: {
      requestId: pending.toolCallId,
      toolName: toolCall.name,
      input: toolCall.arguments,
      isReadOnly: false,
      toolDescription: undefined,
      toolAnnotations: undefined,
      riskLevel: 'moderate',
    },
  };

  if (includeAgentId) {
    return { ...base, agentId: pending.agentSessionId };
  }

  return base;
}

/**
 * Find the workspace session that contains a given agent/thread.
 * Returns the workspace session info if found, null otherwise.
 */
async function findWorkspaceForThread(
  threadId: string
): Promise<{ workspaceSessionId: string } | null> {
  const supervisor = await getSupervisor();
  const workspaces = await supervisor.listWorkspaceSessions();

  for (const ws of workspaces) {
    if (ws.agents.some((a) => a.sessionId === threadId)) {
      return { workspaceSessionId: ws.workspaceSessionId };
    }
  }

  return null;
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Get all pending approvals for the given context.
 *
 * For session scope: Returns ALL pending approvals for the workspace session, with agentId included.
 * For thread scope: Returns only pending approvals for that specific agent, without agentId.
 *
 * @throws RouteValidationError if session/agent not found
 */
export async function getPendingApprovals(
  ctx: ApprovalContext
): Promise<SessionPendingApproval[] | PendingApproval[]> {
  if (ctx.scope === 'session') {
    if (!ctx.workspaceSessionId) {
      throw new RouteValidationError('workspaceSessionId is required for session scope', 400, 'VALIDATION_FAILED');
    }

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(ctx.workspaceSessionId);
    if (!record) {
      throw new RouteValidationError('Session not found', 404, 'RESOURCE_NOT_FOUND');
    }

    const pending = await listPendingPermissions(ctx.workspaceSessionId);
    return pending.map((p) => transformPendingApproval(p, true) as SessionPendingApproval);
  }

  // Thread scope
  if (!ctx.threadId) {
    throw new RouteValidationError('threadId is required for thread scope', 400, 'VALIDATION_FAILED');
  }

  const workspace = await findWorkspaceForThread(ctx.threadId);
  if (!workspace) {
    throw new RouteValidationError('Agent not found', 404, 'RESOURCE_NOT_FOUND');
  }

  const pending = await listPendingPermissions(workspace.workspaceSessionId);
  return pending
    .filter((p) => p.agentSessionId === ctx.threadId)
    .map((p) => transformPendingApproval(p, false));
}

/**
 * Submit an approval decision for a tool call.
 *
 * For session scope: Finds tool call by ID across all agents in the session.
 * For thread scope: Finds tool call by ID only for that specific agent.
 *
 * @throws RouteValidationError if session/agent not found, tool call not found, or tool call is ambiguous
 */
export async function submitApprovalDecision(
  ctx: ApprovalContext,
  encodedToolCallId: string,
  decision: ApprovalDecision
): Promise<ApprovalDecisionResult> {
  const toolCallId = decodeURIComponent(encodedToolCallId);
  const mappedDecision = decision === 'deny' ? 'deny' : 'allow';

  if (ctx.scope === 'session') {
    if (!ctx.workspaceSessionId) {
      throw new RouteValidationError('workspaceSessionId is required for session scope', 400, 'VALIDATION_FAILED');
    }

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(ctx.workspaceSessionId);
    if (!record) {
      throw new RouteValidationError('Session not found', 404, 'RESOURCE_NOT_FOUND');
    }

    const pending = await listPendingPermissions(ctx.workspaceSessionId);
    const matches = pending.filter((p) => p.toolCallId === toolCallId);

    if (matches.length === 0) {
      throw new RouteValidationError('Tool call not found', 404, 'RESOURCE_NOT_FOUND');
    }

    if (matches.length > 1) {
      throw new RouteValidationError('Tool call is ambiguous', 409, 'VALIDATION_FAILED');
    }

    const resolved = await resolvePendingPermission({
      workspaceSessionId: ctx.workspaceSessionId,
      toolCallId,
      decision: mappedDecision,
    });

    if (!resolved) {
      throw new RouteValidationError('Tool call not found', 404, 'RESOURCE_NOT_FOUND');
    }

    return { success: true, toolCallId, decision };
  }

  // Thread scope
  if (!ctx.threadId) {
    throw new RouteValidationError('threadId is required for thread scope', 400, 'VALIDATION_FAILED');
  }

  const workspace = await findWorkspaceForThread(ctx.threadId);
  if (!workspace) {
    throw new RouteValidationError('Agent not found', 404, 'RESOURCE_NOT_FOUND');
  }

  const pending = await listPendingPermissions(workspace.workspaceSessionId);
  const match = pending.find((p) => p.toolCallId === toolCallId && p.agentSessionId === ctx.threadId);

  if (!match) {
    throw new RouteValidationError('Tool call not found', 404, 'RESOURCE_NOT_FOUND');
  }

  const resolved = await resolvePendingPermission({
    workspaceSessionId: workspace.workspaceSessionId,
    toolCallId,
    decision: mappedDecision,
  });

  if (!resolved) {
    throw new RouteValidationError('Tool call not found', 404, 'RESOURCE_NOT_FOUND');
  }

  return { success: true, toolCallId, decision };
}
