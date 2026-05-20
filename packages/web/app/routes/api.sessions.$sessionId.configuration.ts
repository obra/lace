// ABOUTME: REST API endpoints for session configuration - GET, PUT for configuration management
// ABOUTME: Handles session configuration retrieval and updates with validation and inheritance

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
import type { Route } from './+types/api.sessions.$sessionId.configuration';
import {
  configureAgentSession,
  type ApprovalMode,
} from '@lace/web/lib/server/agent-session-config';

const ConfigurationSchema = z
  .object({
    providerInstanceId: z.string().optional(),
    modelId: z.string().optional(),
    toolPolicies: z.record(z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
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
    const workspaceSessionId = requireSessionId(params);
    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      throwNotFound('Session');
    }

    const coordinator = record.agents[0];
    if (!coordinator) {
      return createErrorResponse('Session has no coordinator agent', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }
    const { tools } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: coordinator.sessionId,
      method: 'ent/tools/list',
    })) as { tools: Array<{ name: string }> };
    const availableTools = tools.map((t) => t.name);

    return createSuperjsonResponse({
      configuration: {
        providerInstanceId: coordinator.connectionId,
        modelId: coordinator.modelId,
        toolPolicies: coordinator.toolPolicies ?? {},
        availableTools,
      },
    });
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    if (request.method !== 'PUT') {
      throwMethodNotAllowed();
    }

    const workspaceSessionId = requireSessionId(params);
    const body = (await request.json()) as Record<string, unknown>;
    const validatedData = ConfigurationSchema.parse(body);

    const supervisor = await getSupervisor();
    const record = await supervisor.getWorkspaceSession(workspaceSessionId);
    if (!record) {
      throwNotFound('Session');
    }

    const coordinator = record.agents[0];
    if (!coordinator) {
      return createErrorResponse('Session has no coordinator agent', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    const permissionMode = validatedData.runtimeOverrides?.permissionMode;
    const approvalMode: ApprovalMode =
      permissionMode === 'yolo'
        ? 'dangerouslySkipPermissions'
        : permissionMode === 'read-only'
          ? 'approveReads'
          : 'ask';

    await supervisor.upsertAgentSessionMeta(workspaceSessionId, {
      sessionId: coordinator.sessionId,
      ...(typeof validatedData.providerInstanceId === 'string'
        ? { connectionId: validatedData.providerInstanceId }
        : {}),
      ...(typeof validatedData.modelId === 'string' ? { modelId: validatedData.modelId } : {}),
      ...(validatedData.toolPolicies ? { toolPolicies: validatedData.toolPolicies } : {}),
    });

    await configureAgentSession(supervisor.agentRequest.bind(supervisor), {
      workspaceSessionId,
      sessionId: coordinator.sessionId,
      connectionId:
        typeof validatedData.providerInstanceId === 'string'
          ? validatedData.providerInstanceId
          : undefined,
      modelId: typeof validatedData.modelId === 'string' ? validatedData.modelId : undefined,
      approvalMode,
    });

    const { tools } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: coordinator.sessionId,
      method: 'ent/tools/list',
    })) as { tools: Array<{ name: string }> };
    const availableTools = tools.map((t) => t.name);

    return createSuperjsonResponse({
      configuration: {
        providerInstanceId:
          typeof validatedData.providerInstanceId === 'string'
            ? validatedData.providerInstanceId
            : coordinator.connectionId,
        modelId:
          typeof validatedData.modelId === 'string' ? validatedData.modelId : coordinator.modelId,
        toolPolicies: validatedData.toolPolicies ?? coordinator.toolPolicies ?? {},
        availableTools,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return createErrorResponse('Invalid request data', 400, {
        code: 'VALIDATION_FAILED',
        details: error.errors,
      });
    }
    return errorToResponse(error);
  }
}
