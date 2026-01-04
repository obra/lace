// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { WorkspaceSessionIdSchema } from '@lace/web/lib/validation/workspace-session-id-validation';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { z } from 'zod';
import type { Route } from './+types/api.sessions.$sessionId.configuration';

const ConfigurationSchema = z
  .object({
    providerInstanceId: z.string().optional(),
    modelId: z.string().optional(),
    runtimeOverrides: z
      .object({
        permissionMode: z.enum(['normal', 'yolo', 'read-only']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

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

    const coordinator = record.agents[0];

    return createSuperjsonResponse({
      configuration: {
        providerInstanceId: coordinator?.connectionId,
        modelId: coordinator?.modelId,
        availableTools: [],
      },
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  switch (request.method) {
    case 'PUT':
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
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const supervisor = getSupervisor();
    const record = supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const coordinator = record.agents[0];
    if (!coordinator) {
      return createErrorResponse('Session has no coordinator agent', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    const permissionMode = validatedData.runtimeOverrides?.permissionMode;
    const approvalMode =
      permissionMode === 'yolo'
        ? 'dangerouslySkipPermissions'
        : permissionMode === 'read-only'
          ? 'approveReads'
          : 'ask';

    supervisor.upsertAgentSessionMeta(workspaceSessionId, {
      sessionId: coordinator.sessionId,
      ...(typeof validatedData.providerInstanceId === 'string'
        ? { connectionId: validatedData.providerInstanceId }
        : {}),
      ...(typeof validatedData.modelId === 'string' ? { modelId: validatedData.modelId } : {}),
    });

    await supervisor
      .getPeer(workspaceSessionId, coordinator.sessionId)
      .request('ent/session/configure', {
        ...(typeof validatedData.providerInstanceId === 'string'
          ? { connectionId: validatedData.providerInstanceId }
          : {}),
        ...(typeof validatedData.modelId === 'string' ? { modelId: validatedData.modelId } : {}),
        approvalMode,
      });

    return createSuperjsonResponse({
      configuration: {
        providerInstanceId:
          typeof validatedData.providerInstanceId === 'string'
            ? validatedData.providerInstanceId
            : coordinator.connectionId,
        modelId:
          typeof validatedData.modelId === 'string' ? validatedData.modelId : coordinator.modelId,
        availableTools: [],
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }

    if (error instanceof Error && error.message === 'Session not found') {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update configuration',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
