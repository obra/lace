// ABOUTME: Session detail API endpoint for getting specific session information
// ABOUTME: Returns session metadata and list of agents within the session

import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import {
  requireSessionId,
  throwNotFound,
  throwMethodNotAllowed,
  errorToResponse,
} from '@lace/web/lib/server/route-helpers';
import { z } from 'zod';
import type { Route } from './+types/api.sessions.$sessionId';

// Schema for validating session update requests
const UpdateSessionSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const workspaceSessionId = requireSessionId(params);

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(workspaceSessionId);

    if (!record) {
      throwNotFound('Session');
    }

    const agentsWithStatus = await Promise.all(
      record.agents.map(async (agent) => {
        try {
          const status = (await supervisor.agentRequest({
            workspaceSessionId,
            sessionId: agent.sessionId,
            method: 'ent/agent/status',
            requestParams: {},
          })) as unknown;

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
    return errorToResponse(error);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    if (request.method !== 'PATCH') {
      throwMethodNotAllowed();
    }

    const workspaceSessionId = requireSessionId(params);

    const supervisor = await getSupervisor();
    const existing = await supervisor.getWorkspaceSession(workspaceSessionId);
    if (!existing) {
      throwNotFound('Session');
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

    await supervisor.updateWorkspaceSession(workspaceSessionId, {
      ...(typeof updates.name === 'string' ? { name: updates.name } : {}),
    });

    const record = await supervisor.getWorkspaceSession(workspaceSessionId);
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
    return errorToResponse(error);
  }
}
