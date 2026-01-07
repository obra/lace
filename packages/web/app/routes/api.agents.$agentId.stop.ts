// ABOUTME: Stop endpoint for halting processing in a supervisor-backed agent session
// ABOUTME: Sends $/cancel_request to the agent process via supervisor

import { isAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
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

    if (!isAgentSessionId(agentId)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = await getSupervisor();
    const workspace = (await supervisor.listWorkspaceSessions()).find((ws) =>
      ws.agents.some((a) => a.sessionId === agentId)
    );

    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    await supervisor.agentNotify({
      workspaceSessionId: workspace.workspaceSessionId,
      sessionId: agentId,
      method: '$/cancel_request',
      notifyParams: { requestId: 'api_stop' },
    });

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
