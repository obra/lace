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
    let sessionId: string;

    if (agentId.includes('.')) {
      // Extract session ID from delegate agent ID (e.g., "session.1" -> "session")
      const parts = agentId.split('.');

      // Validate delegate format: exactly two parts
      if (parts.length !== 2) {
        return createErrorResponse(
          'Invalid delegate agent ID format: expected sessionId.number',
          400,
          {
            code: 'VALIDATION_FAILED',
          }
        );
      }

      const extractedSessionId = parts[0];
      const delegateIndex = parts[1];

      // Validate both parts are non-empty
      if (!extractedSessionId || !delegateIndex) {
        return createErrorResponse('Invalid delegate agent ID: empty session ID or index', 400, {
          code: 'VALIDATION_FAILED',
        });
      }

      // Validate delegate index is numeric
      if (!/^\d+$/.test(delegateIndex)) {
        return createErrorResponse('Invalid delegate agent ID: index must be numeric', 400, {
          code: 'VALIDATION_FAILED',
        });
      }

      // Validate extracted session ID format
      if (!isValidThreadId(extractedSessionId)) {
        return createErrorResponse('Invalid delegate agent ID: malformed session ID', 400, {
          code: 'VALIDATION_FAILED',
        });
      }

      sessionId = extractedSessionId;
    } else {
      // Coordinator agent: agentId is the session ID
      sessionId = agentId;
    }

    const session = await sessionService.getSession(asThreadId(sessionId));
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
