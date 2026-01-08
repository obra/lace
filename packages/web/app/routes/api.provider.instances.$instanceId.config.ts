// ABOUTME: API endpoint to update model configuration for a provider instance
// ABOUTME: Saves filtering settings like disabled models, required capabilities, etc.

import type { Route } from './+types/api.provider.instances.$instanceId.config';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { z } from 'zod';

const ModelConfigSchema = z
  .object({
    enableNewModels: z.boolean().default(true),
    disabledModels: z.array(z.string()).default([]),
    disabledProviders: z.array(z.string()).default([]),
    filters: z
      .object({
        requiredParameters: z.array(z.string()).optional(),
        maxPromptCostPerMillion: z.number().nonnegative().optional(),
        maxCompletionCostPerMillion: z.number().nonnegative().optional(),
        minContextLength: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function action({ params, request }: Route.ActionArgs) {
  try {
    const { instanceId } = params;

    if (request.method !== 'PATCH') {
      return createErrorResponse('Method not allowed', 405);
    }

    // Parse request body
    const body = (await request.json()) as { modelConfig: unknown };

    // Validate model config
    const parseResult = ModelConfigSchema.safeParse(body.modelConfig);
    if (!parseResult.success) {
      return createErrorResponse('Invalid model configuration', 400, {
        error: parseResult.error.errors,
      });
    }

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const { connections } = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/connections/list',
    })) as { connections: Array<{ connectionId: string; name: string }> };

    const existing = connections.find((c) => c.connectionId === instanceId);
    if (!existing) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404);
    }

    await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/connections/upsert',
      requestParams: {
        connection: {
          connectionId: instanceId,
          name: existing.name,
          config: { modelConfig: parseResult.data },
        },
      },
    });

    return createSuperjsonResponse({
      success: true,
      message: 'Configuration saved successfully',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update configuration';
    return createErrorResponse(errorMessage, 500);
  }
}
