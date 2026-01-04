// ABOUTME: REST API endpoints for supervisor-backed agent sessions - GET, PUT for agent updates
// ABOUTME: Agent IDs are Ent protocol sessionIds; metadata is stored in supervisor workspace session store

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { SessionIdSchema } from '@lace/ent-protocol';
import { z } from 'zod';
import { ProviderRegistry } from '@lace/web/lib/server/lace-imports';
import type { Route } from './+types/api.agents.$agentId';

const AgentUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    providerInstanceId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
  })
  .refine(
    (data) => {
      if (data.providerInstanceId || data.modelId) {
        return data.providerInstanceId && data.modelId;
      }
      return true;
    },
    { message: 'Both providerInstanceId and modelId must be provided together' }
  );

function findWorkspaceForAgentSession(agentSessionId: string) {
  const supervisor = getSupervisor();
  const record = supervisor
    .listWorkspaceSessions()
    .find((ws) => ws.agents.some((a) => a.sessionId === agentSessionId));

  return { supervisor, record };
}

export async function loader({ request: _request, params }: Route.LoaderArgs) {
  try {
    const { agentId } = params as { agentId: string };

    if (!SessionIdSchema.safeParse(agentId).success) {
      return createErrorResponse('Invalid agent ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const { record } = findWorkspaceForAgentSession(agentId);
    if (!record) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const meta = record.agents.find((a) => a.sessionId === agentId);
    if (!meta) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    return createSuperjsonResponse({
      threadId: meta.sessionId,
      name: meta.name ?? '',
      providerInstanceId: meta.connectionId ?? '',
      modelId: meta.modelId ?? '',
      persona: '',
      status: 'idle',
      tokenUsage: undefined,
      createdAt: meta.createdAt ? new Date(meta.createdAt) : undefined,
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch agent',
      500,
      {
        code: 'INTERNAL_SERVER_ERROR',
      }
    );
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'PUT') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agentId } = params as { agentId: string };

    if (!SessionIdSchema.safeParse(agentId).success) {
      return createErrorResponse('Invalid agent ID', 400, { code: 'VALIDATION_FAILED' });
    }

    const body = (await request.json()) as Record<string, unknown>;

    let validatedData;
    try {
      validatedData = AgentUpdateSchema.parse(body);
    } catch (zodError) {
      if (zodError instanceof z.ZodError) {
        return createErrorResponse('Invalid request data', 400, {
          code: 'VALIDATION_FAILED',
          details: zodError.errors,
        });
      }
      throw zodError;
    }

    const { supervisor, record } = findWorkspaceForAgentSession(agentId);
    if (!record) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const meta = record.agents.find((a) => a.sessionId === agentId);
    if (!meta) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    if (validatedData.providerInstanceId) {
      const registry = ProviderRegistry.getInstance();
      const configuredInstances = await registry.getConfiguredInstances();
      const instance = configuredInstances.find(
        (inst) => inst.id === validatedData.providerInstanceId
      );
      if (!instance) {
        return createErrorResponse('Provider instance not found', 400, {
          code: 'VALIDATION_FAILED',
          details: {
            availableInstances: configuredInstances.map((i) => ({
              id: i.id,
              name: (i as { name?: string; displayName: string }).name || i.displayName,
            })),
          },
        });
      }
    }

    supervisor.upsertAgentSessionMeta(record.workspaceSessionId, {
      sessionId: agentId,
      ...(typeof validatedData.name === 'string' ? { name: validatedData.name } : {}),
      ...(typeof validatedData.providerInstanceId === 'string'
        ? { connectionId: validatedData.providerInstanceId }
        : {}),
      ...(typeof validatedData.modelId === 'string' ? { modelId: validatedData.modelId } : {}),
    });

    if (validatedData.providerInstanceId && validatedData.modelId) {
      await supervisor
        .getPeer(record.workspaceSessionId, agentId)
        .request('ent/session/configure', {
          connectionId: validatedData.providerInstanceId,
          modelId: validatedData.modelId,
        });
    }

    const updated = supervisor.getWorkspaceSession(record.workspaceSessionId);
    const updatedMeta = updated?.agents.find((a) => a.sessionId === agentId);

    return createSuperjsonResponse({
      threadId: agentId,
      name: updatedMeta?.name ?? validatedData.name ?? '',
      providerInstanceId: updatedMeta?.connectionId ?? validatedData.providerInstanceId ?? '',
      modelId: updatedMeta?.modelId ?? validatedData.modelId ?? '',
      persona: '',
      status: 'idle',
      tokenUsage: undefined,
      createdAt: updatedMeta?.createdAt ? new Date(updatedMeta.createdAt) : undefined,
    });
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to update agent',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
