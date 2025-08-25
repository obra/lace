// ABOUTME: Recovery API that uses core ThreadManager query methods
// ABOUTME: Thin web layer over core approval system

import { z } from 'zod';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { ThreadIdSchema } from '@/lib/validation/schemas';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.threads.$threadId.approvals.pending';

// Validation schema
const ParamsSchema = z.object({
  threadId: ThreadIdSchema,
});

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    // Validate parameters
    const paramsResult = ParamsSchema.safeParse(params);
    if (!paramsResult.success) {
      return createErrorResponse('Invalid parameters', 400, {
        code: 'VALIDATION_ERROR',
        details: paramsResult.error.format(),
      });
    }

    const { threadId } = paramsResult.data;

    // Get session first, then agent (following existing pattern)
    const sessionService = getSessionService();

    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionIdStr: string = threadId.includes('.')
      ? (threadId.split('.')[0] ?? threadId)
      : threadId;

    const session = await sessionService.getSession(asThreadId(sessionIdStr));
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(asThreadId(threadId));
    if (!agent) {
      return createErrorResponse('Agent not found for thread', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Use Agent interface to get pending approvals
    const rawPendingApprovals = agent.getPendingApprovals();

    // Reconstruct ToolApprovalRequestData for each pending approval
    const pendingApprovals = rawPendingApprovals.map((approval) => {
      const toolCall = approval.toolCall as { name: string; arguments: unknown };

      // Try to get tool from executor to determine metadata (may not be available in all contexts)
      let tool;
      try {
        tool = agent.toolExecutor.getTool?.(toolCall.name);
      } catch {
        // Tool not available, use defaults
        tool = null;
      }

      const isReadOnly = tool?.annotations?.readOnlyHint ?? false;

      // Determine risk level based on tool annotations
      let riskLevel: 'safe' | 'moderate' | 'destructive' = 'moderate';
      if (tool?.annotations?.readOnlyHint) {
        riskLevel = 'safe';
      } else if (tool?.annotations?.destructiveHint) {
        riskLevel = 'destructive';
      }

      const requestData = {
        requestId: approval.toolCallId,
        toolName: toolCall.name,
        input: toolCall.arguments,
        isReadOnly,
        toolDescription: tool?.description,
        toolAnnotations: tool?.annotations,
        riskLevel,
      };

      return {
        toolCallId: approval.toolCallId,
        toolCall: approval.toolCall,
        requestedAt: approval.requestedAt,
        requestData,
      };
    });

    return createSuperjsonResponse(pendingApprovals);
  } catch (_error) {
    return createErrorResponse('Failed to get pending approvals', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
