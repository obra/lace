// ABOUTME: Session-wide approval aggregation API for integrated WebUI approval experience
// ABOUTME: Collects pending approvals from ALL agents in a session and presents unified view

import { z } from 'zod';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { ThreadIdSchema } from '@/lib/validation/schemas';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { logger } from '~/utils/logger';
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

    logger.info(`[SESSION_APPROVAL] Session ${sessionId} found, getting agents`);

    // Get agent info objects first, then get actual Agent instances
    const agentInfos = session.getAgents();

    logger.info(
      `[SESSION_APPROVAL] Found ${agentInfos.length} agent infos in session ${sessionId}:`,
      {
        agentIds: agentInfos.map((a) => a.threadId),
      }
    );

    if (agentInfos.length === 0) {
      logger.info(`[SESSION_APPROVAL] No agents in session, returning empty array`);
      return createSuperjsonResponse([]);
    }

    // Collect pending approvals from ALL agents
    const allPendingApprovals = [];

    for (const agentInfo of agentInfos) {
      logger.info(`[SESSION_APPROVAL] Getting actual Agent instance for ${agentInfo.threadId}`);

      // Get the actual Agent instance (not just the info object)
      const agent = session.getAgent(asThreadId(agentInfo.threadId));
      if (!agent) {
        logger.warn(`[SESSION_APPROVAL] Agent instance not found for ${agentInfo.threadId}`);
        continue;
      }

      logger.info(`[SESSION_APPROVAL] Got Agent instance ${agent.threadId}, checking methods:`, {
        constructor: agent.constructor.name,
        hasGetPendingApprovals: 'getPendingApprovals' in agent,
        typeOfGetPendingApprovals: typeof agent.getPendingApprovals,
      });

      // Check if agent has getPendingApprovals method
      if (typeof agent.getPendingApprovals !== 'function') {
        logger.warn(
          `[SESSION_APPROVAL] Agent ${agent.threadId} does not have getPendingApprovals method`
        );
        continue;
      }

      logger.debug(
        `[SESSION_APPROVAL] Agent ${agent.threadId} has getPendingApprovals method, calling it`
      );
      try {
        // Get pending approvals for this agent
        const rawPendingApprovals = agent.getPendingApprovals();

        logger.info(
          `[SESSION_APPROVAL] Agent ${agent.threadId} returned ${rawPendingApprovals.length} pending approvals:`,
          {
            approvals: rawPendingApprovals.map((a) => ({
              toolCallId: a.toolCallId,
              toolName: (a.toolCall as { name: string })?.name,
            })),
          }
        );

        // Transform each approval with agent context
        for (const approval of rawPendingApprovals) {
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
            toolCall: approval.toolCall,
            requestedAt: approval.requestedAt,
            requestData,
            // Include agent context in the approval
            agentId: agent.threadId,
          });
        }
      } catch (error) {
        // Log detailed error but continue with other agents
        logger.warn(`[SESSION_APPROVAL] Failed to get approvals for agent ${agent.threadId}:`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          threadId: agent.threadId,
        });
      }
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
