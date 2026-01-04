// ABOUTME: Session detail API endpoint for getting specific session information
// ABOUTME: Returns session metadata and list of agents within the session

import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { WorkspaceSessionIdSchema } from '@lace/web/lib/validation/workspace-session-id-validation';
import { z } from 'zod';
import type { Route } from './+types/api.sessions.$sessionId';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// Schema for validating session update requests
const UpdateSessionSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

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

    const agentsWithStatus = await Promise.all(
      record.agents.map(async (agent) => {
        try {
          const status = (await supervisor
            .getPeer(workspaceSessionId, agent.sessionId)
            .request('ent/agent/status', {})) as unknown;

          const statusRecord = status as {
            currentTurn?: { status?: string } | undefined;
            pendingPermissions?: unknown[] | undefined;
          };

          const hasPendingPermissions = Array.isArray(statusRecord.pendingPermissions)
            ? statusRecord.pendingPermissions.length > 0
            : false;

          const turnStatus =
            statusRecord.currentTurn && typeof statusRecord.currentTurn === 'object'
              ? statusRecord.currentTurn.status
              : undefined;

          const agentStatus =
            hasPendingPermissions || turnStatus === 'awaiting_permission'
              ? 'tool_execution'
              : turnStatus === 'running'
                ? 'thinking'
                : 'idle';

          return {
            threadId: agent.sessionId,
            name: agent.name ?? '',
            providerInstanceId: agent.connectionId,
            modelId: agent.modelId,
            status: agentStatus,
            createdAt: new Date(agent.createdAt),
          };
        } catch {
          return {
            threadId: agent.sessionId,
            name: agent.name ?? '',
            providerInstanceId: agent.connectionId,
            modelId: agent.modelId,
            status: 'idle',
            createdAt: new Date(agent.createdAt),
          };
        }
      })
    );

    const sessionData = {
      id: record.workspaceSessionId,
      name: record.name ?? 'Session',
      createdAt: new Date(record.createdAt),
      agents: agentsWithStatus,
    };

    return createSuperjsonResponse(sessionData);
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  switch (request.method) {
    case 'PATCH':
      break;
    default:
      return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { sessionId: sessionIdParam } = params as { sessionId: string };

    const parsed = WorkspaceSessionIdSchema.safeParse(sessionIdParam);
    if (!parsed.success) {
      return createErrorResponse('Invalid session ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const workspaceSessionId = parsed.data;

    const supervisor = getSupervisor();
    const existing = supervisor.getWorkspaceSession(workspaceSessionId);
    if (!existing) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Parse and validate request body
    const bodyRaw: unknown = await request.json();
    const bodyResult = UpdateSessionSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: bodyResult.error.errors,
      });
    }

    const updates = bodyResult.data;

    supervisor.updateWorkspaceSession(workspaceSessionId, {
      ...(typeof updates.name === 'string' ? { name: updates.name } : {}),
    });

    const record = supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      return createErrorResponse('Session not found after update', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    const sessionData = {
      id: record.workspaceSessionId,
      name: record.name ?? 'Session',
      createdAt: new Date(record.createdAt),
      agents: record.agents.map((agent) => ({
        threadId: agent.sessionId,
        name: agent.name ?? '',
        providerInstanceId: agent.connectionId,
        modelId: agent.modelId,
        status: 'idle',
        createdAt: new Date(agent.createdAt),
      })),
    };

    return createSuperjsonResponse(sessionData);
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
