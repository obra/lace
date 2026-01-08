// ABOUTME: API endpoint to manually refresh OpenRouter catalog for an instance
// ABOUTME: Fetches latest models from OpenRouter API and updates cache

import type { Route } from './+types/api.provider.instances.$instanceId.refresh';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';

export async function action({ params, request }: Route.ActionArgs) {
  try {
    const { instanceId } = params;

    if (request.method !== 'POST') {
      return createErrorResponse('Method not allowed', 405);
    }

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const refreshed = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/models/refresh',
      requestParams: { connectionId: instanceId },
    })) as { ok: boolean; refreshedAt: string; error?: string };

    if (!refreshed.ok) {
      return createErrorResponse(refreshed.error ?? 'Failed to refresh catalog', 500);
    }

    const listed = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/models/list',
      requestParams: { connectionId: instanceId },
    })) as { models: unknown[] };

    return createSuperjsonResponse({
      success: true,
      modelCount: Array.isArray(listed.models) ? listed.models.length : 0,
      lastUpdated: refreshed.refreshedAt,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to refresh catalog';
    return createErrorResponse(errorMessage, 500);
  }
}
