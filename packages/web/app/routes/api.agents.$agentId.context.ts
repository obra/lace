// ABOUTME: API endpoint for agent context breakdown
// ABOUTME: Proxies to ent/session/context_breakdown via supervisor-backed agent sessions

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { findWorkspaceForAgentSession } from '@lace/web/lib/server/agent-utils';
import { isAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
import type { Route } from './+types/api.agents.$agentId.context';

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { agentId } = params as { agentId: string };

    if (!isAgentSessionId(agentId)) {
      return createErrorResponse('Invalid agent ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const { supervisor, record } = await findWorkspaceForAgentSession(agentId);
    if (!record) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const breakdown = await supervisor.agentRequest({
      workspaceSessionId: record.workspaceSessionId,
      sessionId: agentId,
      method: 'ent/session/context_breakdown',
    });

    return createSuperjsonResponse(breakdown);
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch context breakdown',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
