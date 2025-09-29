// ABOUTME: API endpoint for agent context breakdown
// ABOUTME: Returns detailed token usage categorization for an agent's thread

import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.agents.$agentId.context';
import { ContextAnalyzer } from '@lace/core/token-management';
import type { Agent } from '@lace/core/agents/agent';

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { agentId: agentIdParam } = params as { agentId: string };

    // Validate agent ID format
    if (!isValidThreadId(agentIdParam)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const agentId = asThreadId(agentIdParam);
    const sessionService = getSessionService();

    // For coordinator agents, agentId = sessionId
    // For delegate agents, agentId = sessionId.number
    let sessionId = agentId;
    if (agentId.includes('.')) {
      // Extract session ID from delegate agent ID (e.g., "session.1" -> "session")
      sessionId = asThreadId(agentId.split('.')[0]!);
    }

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get the specific agent
    const agent = session.getAgent(agentId) as Agent | null;
    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Analyze context
    const breakdown = await ContextAnalyzer.analyze(agentId, agent);

    // Return as JSON
    return createSuperjsonResponse(breakdown, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
