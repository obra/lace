// ABOUTME: Session-wide approval aggregation API for integrated WebUI approval experience
// ABOUTME: Collects pending approvals from ALL agents in a session and presents unified view

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor, listPendingPermissions } from '@lace/web/lib/server/supervisor-service';
import { WorkspaceSessionIdSchema } from '@lace/web/lib/validation/workspace-session-id-validation';
import type { SessionPendingApproval } from '@lace/web/types/api';
import type { Route } from './+types/api.sessions.$sessionId.approvals.pending';

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };
    const parsed = WorkspaceSessionIdSchema.safeParse(sessionIdParam);
    if (!parsed.success) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const workspaceSessionId = parsed.data;
    const supervisor = getSupervisor();
    const record = supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const pending = listPendingPermissions(workspaceSessionId);
    const approvals: SessionPendingApproval[] = pending.map((p) => {
      const toolName =
        typeof p.toolCall?.name === 'string'
          ? p.toolCall.name
          : typeof p.params.tool === 'string'
            ? p.params.tool
            : '';
      const toolCall = {
        name: toolName,
        arguments: p.toolCall?.arguments ?? {},
      };

      return {
        toolCallId: p.toolCallId,
        toolCall,
        requestedAt: p.requestedAt,
        requestData: {
          requestId: p.toolCallId,
          toolName: toolCall.name,
          input: toolCall.arguments,
          isReadOnly: false,
          toolDescription: undefined,
          toolAnnotations: undefined,
          riskLevel: 'moderate',
        },
        agentId: p.agentSessionId,
      };
    });

    return createSuperjsonResponse(approvals);
  } catch (_error) {
    return createErrorResponse('Failed to get pending approvals', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
