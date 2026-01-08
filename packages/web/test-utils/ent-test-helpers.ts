// ABOUTME: Web test helpers that exercise the agent via ENT JSON-RPC (no agent library reach-ins)
// ABOUTME: Used by integration tests that need provider connections without network flakiness

import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';

export async function createEntTestConnection(params?: {
  providerId?: string;
  name?: string;
  config?: Record<string, unknown>;
}): Promise<{ connectionId: string; providerId: string }> {
  const supervisor = await getSupervisor();
  const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

  const providerId = params?.providerId ?? 'openai';
  const name = params?.name ?? 'Test Connection';
  const config = params?.config ?? {};

  const result = (await supervisor.agentRequest({
    workspaceSessionId,
    sessionId: agentSessionId,
    method: 'ent/connections/upsert',
    requestParams: {
      providerId,
      connection: {
        name,
        config,
      },
    },
  })) as { connectionId: string; providerId: string };

  return { connectionId: result.connectionId, providerId: result.providerId };
}

export async function deleteEntTestConnection(connectionId: string): Promise<void> {
  const supervisor = await getSupervisor();
  const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

  await supervisor.agentRequest({
    workspaceSessionId,
    sessionId: agentSessionId,
    method: 'ent/connections/delete',
    requestParams: { connectionId },
  });
}
