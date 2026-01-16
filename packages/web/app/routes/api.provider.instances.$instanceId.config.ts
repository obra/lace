// ABOUTME: API endpoint to update model configuration for a provider instance
// ABOUTME: Saves filtering settings like disabled models, required capabilities, etc.

import type { Route } from './+types/api.provider.instances.$instanceId.config';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { requireParam, errorToResponse } from '@lace/web/lib/server/route-helpers';
import {
  getProviderContext,
  requireProviderInstance,
  ModelConfigSchema,
} from '@lace/web/lib/server/provider-route-handlers';

export async function action({ params, request }: Route.ActionArgs) {
  try {
    const instanceId = requireParam(params as Record<string, string | undefined>, 'instanceId');

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

    const ctx = await getProviderContext();
    const existing = await requireProviderInstance(ctx, instanceId);

    await ctx.supervisor.agentRequest({
      workspaceSessionId: ctx.workspaceSessionId,
      sessionId: ctx.agentSessionId,
      method: 'ent/connections/upsert',
      requestParams: {
        connection: {
          connectionId: instanceId,
          name: existing.displayName,
          config: { modelConfig: parseResult.data },
        },
      },
    });

    return createSuperjsonResponse({
      success: true,
      message: 'Configuration saved successfully',
    });
  } catch (error: unknown) {
    return errorToResponse(error, 'Failed to update configuration');
  }
}
