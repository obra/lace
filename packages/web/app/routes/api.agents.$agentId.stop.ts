// ABOUTME: Stop endpoint for halting processing in a supervisor-backed agent session
// ABOUTME: Sends session/cancel to the agent process via supervisor

import { SessionIdSchema } from '@lace/ent-protocol';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import type { Route } from './+types/api.agents.$agentId.stop';

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agentId } = params as { agentId: string };

    if (!SessionIdSchema.safeParse(agentId).success) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = getSupervisor();
    const workspace = supervisor
      .listWorkspaceSessions()
      .find((ws) => ws.agents.some((a) => a.sessionId === agentId));

    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    supervisor.getPeer(workspace.workspaceSessionId, agentId).notify('session/cancel');

    return createSuperjsonResponse({
      success: true,
      stopped: true,
      agentId,
      message: 'Agent processing stopped successfully',
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
