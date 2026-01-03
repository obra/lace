// ABOUTME: Recovery API that uses core ThreadManager query methods
// ABOUTME: Thin web layer over supervisor-backed approval system

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { SessionIdSchema } from '@lace/ent-protocol';
import { getSupervisor, listPendingPermissions } from '@lace/web/lib/server/supervisor-service';
import type { Route } from './+types/api.threads.$threadId.approvals.pending';

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { threadId: threadIdParam } = params as { threadId: string };
    if (!SessionIdSchema.safeParse(threadIdParam).success) {
      return createErrorResponse('Invalid thread ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const supervisor = getSupervisor();
    const workspace = supervisor
      .listWorkspaceSessions()
      .find((ws) => ws.agents.some((a) => a.sessionId === threadIdParam));
    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const pending = listPendingPermissions(workspace.workspaceSessionId)
      .filter((p) => p.agentSessionId === threadIdParam)
      .map((p) => {
        const toolName =
          typeof p.toolCall?.name === 'string'
            ? p.toolCall.name
            : typeof p.params.tool === 'string'
              ? p.params.tool
              : '';
        const toolCall = { name: toolName, arguments: p.toolCall?.arguments ?? {} };

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
            riskLevel: 'moderate' as const,
          },
        };
      });

    return createSuperjsonResponse(pending);
  } catch (_error) {
    return createErrorResponse('Failed to get pending approvals', 500, {
      code: 'INTERNAL_SERVER_ERROR',
    });
  }
}
