// ABOUTME: Session-level approval decision endpoint
// ABOUTME: Routes approval decisions to the correct agent that created the tool call

import { z } from 'zod';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { ThreadIdSchema } from '@/lib/validation/schemas';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { logger } from '~/utils/logger';
import { ApprovalDecision } from '@/types/core';
import type { Route } from './+types/api.sessions.$sessionId.approvals.$toolCallId';

// Validation schemas
const ParamsSchema = z.object({
  sessionId: ThreadIdSchema,
  toolCallId: z.string().min(1, 'Tool call ID cannot be empty'),
});

const BodySchema = z.object({
  decision: z.enum(['allow_once', 'allow_session', 'deny'], {
    errorMap: () => ({ message: 'Decision must be "allow_once", "allow_session", or "deny"' }),
  }),
});

export async function action({ request, params }: Route.ActionArgs) {
  try {
    // Validate parameters
    const paramsResult = ParamsSchema.safeParse(params);
    if (!paramsResult.success) {
      return createErrorResponse('Invalid parameters', 400, {
        code: 'VALIDATION_ERROR',
        details: paramsResult.error.format(),
      });
    }

    const { sessionId, toolCallId } = paramsResult.data;

    // Validate request body
    const body = (await request.json()) as unknown;
    const bodyResult = BodySchema.safeParse(body);
    if (!bodyResult.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.format(),
      });
    }

    const { decision } = bodyResult.data;

    logger.info(
      `[SESSION_APPROVAL_DECISION] Processing ${decision} for tool call ${toolCallId} in session ${sessionId}`
    );

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Use the new efficient session-wide method to find which agent owns this approval
    const pendingApprovals = session.getPendingApprovals();

    logger.info(
      `[SESSION_APPROVAL_DECISION] Session has ${pendingApprovals.length} pending approvals`
    );

    const approval = pendingApprovals.find((a) => a.toolCallId === toolCallId);

    if (!approval) {
      logger.warn(
        `[SESSION_APPROVAL_DECISION] Tool call ${toolCallId} not found in session's pending approvals`
      );
      return createErrorResponse(
        `Tool call "${toolCallId}" not found in any pending approvals for session ${sessionId}`,
        404,
        { code: 'RESOURCE_NOT_FOUND' }
      );
    }

    // Get the agent that owns this approval
    const targetAgent = session.getAgent(asThreadId(approval.threadId));

    if (!targetAgent) {
      logger.error(
        `[SESSION_APPROVAL_DECISION] Agent ${approval.threadId} not found for tool call ${toolCallId}`
      );
      return createErrorResponse(
        `Agent "${approval.threadId}" not found for tool call "${toolCallId}"`,
        500,
        { code: 'INTERNAL_SERVER_ERROR' }
      );
    }

    logger.info(
      `[SESSION_APPROVAL_DECISION] Found tool call ${toolCallId} in agent ${targetAgent.threadId}`
    );

    // Submit approval decision to the correct agent using the same method as thread endpoint
    try {
      await targetAgent.handleApprovalResponse(toolCallId, decision as ApprovalDecision);

      logger.info(
        `[SESSION_APPROVAL_DECISION] Successfully submitted ${decision} decision for tool call ${toolCallId} to agent ${targetAgent.threadId}`
      );

      return createSuperjsonResponse({
        success: true,
        agentId: targetAgent.threadId,
        toolCallId,
        decision,
      });
    } catch (error) {
      logger.error(`[SESSION_APPROVAL_DECISION] Failed to submit approval decision:`, error);
      return createErrorResponse('Failed to submit approval decision', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
  } catch (error) {
    logger.error('[SESSION_APPROVAL_DECISION] Failed to process approval decision:', error);
    return createErrorResponse('Failed to process approval decision', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
