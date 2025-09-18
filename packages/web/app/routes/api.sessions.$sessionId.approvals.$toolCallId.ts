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

    // Get session
    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Find which agent has this pending approval
    const agentInfos = session.getAgents();
    let targetAgent = null;

    logger.info(
      `[SESSION_APPROVAL] Looking for tool call ${toolCallId} in ${agentInfos.length} agents`
    );

    for (const agentInfo of agentInfos) {
      // Get actual Agent instance
      const agent = session.getAgent(asThreadId(agentInfo.threadId));
      if (!agent) {
        logger.warn(`[SESSION_APPROVAL] Agent instance not found for ${agentInfo.threadId}`);
        continue;
      }

      logger.info(
        `[SESSION_APPROVAL] Checking agent ${agent.threadId} for tool call ${toolCallId}`
      );

      try {
        const pendingApprovals = agent.getPendingApprovals();
        logger.info(
          `[SESSION_APPROVAL] Agent ${agent.threadId} has ${pendingApprovals.length} pending approvals:`,
          {
            approvals: pendingApprovals.map((a) => a.toolCallId),
          }
        );

        const hasApproval = pendingApprovals.some((approval) => approval.toolCallId === toolCallId);

        if (hasApproval) {
          logger.info(
            `[SESSION_APPROVAL] Found tool call ${toolCallId} in agent ${agent.threadId}`
          );
          targetAgent = agent;
          break;
        }
      } catch (error) {
        // Log detailed error
        logger.warn(`[SESSION_APPROVAL] Failed to check approvals for agent ${agent.threadId}:`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    if (!targetAgent) {
      return createErrorResponse(
        `Tool call "${toolCallId}" not found in any pending approvals for session ${sessionId}`,
        404,
        { code: 'RESOURCE_NOT_FOUND' }
      );
    }

    // Submit approval decision to the correct agent using the same method as thread endpoint
    try {
      await targetAgent.handleApprovalResponse(toolCallId, decision as ApprovalDecision);

      logger.info(
        `[SESSION_APPROVAL] Submitted ${decision} decision for tool call ${toolCallId} to agent ${targetAgent.threadId}`
      );

      return createSuperjsonResponse({
        success: true,
        agentId: targetAgent.threadId,
        toolCallId,
        decision,
      });
    } catch (error) {
      logger.error(`[SESSION_APPROVAL] Failed to submit approval decision:`, error);
      return createErrorResponse('Failed to submit approval decision', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
  } catch (error) {
    logger.error('[SESSION_APPROVAL] Failed to process approval decision:', error);
    return createErrorResponse('Failed to process approval decision', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
