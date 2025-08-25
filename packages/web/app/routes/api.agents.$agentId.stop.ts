// ABOUTME: Stop endpoint for halting agent processing while keeping agent alive
// ABOUTME: Calls agent.abort() to stop current generation but preserves agent state

import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.agents.$agentId.stop';

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agentId } = params;

    if (!isValidThreadId(agentId)) {
      return createErrorResponse('Invalid agent ID format', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const agentThreadId = asThreadId(agentId);

    // Extract sessionId from agentId (agents are child threads like sessionId.1)
    const sessionIdStr = agentThreadId.split('.')[0];
    if (!sessionIdStr || !isValidThreadId(sessionIdStr)) {
      return createErrorResponse('Invalid session ID derived from agent ID', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const sessionId = asThreadId(sessionIdStr);

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    const agent = session.getAgent(agentThreadId);

    if (!agent) {
      return createErrorResponse('Agent not found', 404, {
        code: 'RESOURCE_NOT_FOUND',
      });
    }

    // Attempt to stop the agent's current processing
    const stopped = agent.abort();

    // Clear the provider cache to ensure fresh credentials are loaded
    // This is a temporary workaround for the caching issue

    return createSuperjsonResponse({
      success: true,
      stopped,
      agentId: agentThreadId,
      message: stopped
        ? 'Agent processing stopped successfully'
        : 'Agent was not currently processing',
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
