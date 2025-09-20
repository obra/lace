// ABOUTME: Session-wide approval aggregation API for integrated WebUI approval experience
// ABOUTME: Collects pending approvals from ALL agents in a session and presents unified view

import { z } from 'zod';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { ThreadIdSchema } from '@/lib/validation/schemas';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { logger } from '~/utils/logger';
import type { SessionPendingApproval } from '@/types/api';
import type { Route } from './+types/api.sessions.$sessionId.approvals.pending';

// Validation schema
const ParamsSchema = z.object({
  sessionId: ThreadIdSchema,
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    // Validate parameters
    const paramsResult = ParamsSchema.safeParse(params);
    if (!paramsResult.success) {
      return createErrorResponse('Invalid parameters', 400, {
        code: 'VALIDATION_ERROR',
        details: paramsResult.error.format(),
      });
    }

    const { sessionId } = paramsResult.data;

    logger.info(`[SESSION_APPROVAL] Getting session ${sessionId}`);

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      logger.warn(`[SESSION_APPROVAL] Session ${sessionId} not found`);
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    logger.info(`[SESSION_APPROVAL] Session ${sessionId} found, getting pending approvals`);

    // Get all pending approvals for the session with a single query
    const rawPendingApprovals = session.getPendingApprovals();

    logger.info(
      `[SESSION_APPROVAL] Session ${sessionId} has ${rawPendingApprovals.length} pending approvals`
    );

    if (rawPendingApprovals.length === 0) {
      logger.info(`[SESSION_APPROVAL] No pending approvals in session, returning empty array`);
      return createSuperjsonResponse([]);
    }

    // Transform pending approvals with agent context and tool metadata
    const allPendingApprovals: SessionPendingApproval[] = [];

    for (const approval of rawPendingApprovals) {
      const agentId = asThreadId(approval.threadId);
      const agent = session.getAgent(agentId);

      if (!agent) {
        logger.warn(`[SESSION_APPROVAL] Agent instance not found for ${approval.threadId}`);
        continue;
      }

      const toolCall = approval.toolCall as { name: string; arguments: unknown };

      // Get tool metadata from this agent's ToolExecutor
      let tool;
      try {
        tool = agent.toolExecutor.getTool?.(toolCall.name);
      } catch {
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

      allPendingApprovals.push({
        toolCallId: approval.toolCallId,
        toolCall: toolCall,
        requestedAt: approval.requestedAt,
        requestData,
        // Include agent context in the approval
        agentId,
      });
    }

    // Sort by requested time (oldest first for FIFO processing)
    allPendingApprovals.sort(
      (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
    );

    logger.info(
      `[SESSION_APPROVAL] Returning ${allPendingApprovals.length} total pending approvals for session ${sessionId}:`,
      {
        approvals: allPendingApprovals.map((a) => ({
          toolCallId: a.toolCallId,
          toolName: a.requestData.toolName,
          agentId: a.agentId,
          requestedAt: a.requestedAt,
        })),
      }
    );

    return createSuperjsonResponse(allPendingApprovals);
  } catch (error) {
    logger.error('[SESSION_APPROVAL] Failed to get session-wide pending approvals:', error);
    return createErrorResponse('Failed to get pending approvals', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
