// ABOUTME: Provider instance connection testing endpoint
// ABOUTME: Tests connection to configured provider instance and returns status

import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { getProviderManagementAgent, getSupervisor } from '@lace/web/lib/server/supervisor-service';
import type { Route } from './+types/api.provider.instances.$instanceId.test';

export interface TestConnectionResponse {
  success: boolean;
  status: 'connected' | 'error';
  message?: string;
  testedAt: string;
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createSuperjsonResponse({
      success: false,
      status: 'error',
      message: 'Method not allowed',
      testedAt: new Date().toISOString(),
    } as TestConnectionResponse);
  }

  try {
    const { instanceId } = params;

    const supervisor = await getSupervisor();
    const { workspaceSessionId, agentSessionId } = await getProviderManagementAgent();

    const result = (await supervisor.agentRequest({
      workspaceSessionId,
      sessionId: agentSessionId,
      method: 'ent/connections/test',
      requestParams: { connectionId: instanceId },
    })) as { ok: boolean; error?: string };

    return createSuperjsonResponse({
      success: result.ok,
      status: result.ok ? 'connected' : 'error',
      message: result.ok
        ? 'Connection test successful'
        : (result.error ?? 'Connection test failed'),
      testedAt: new Date().toISOString(),
    } as TestConnectionResponse);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Connection test failed';

    return createSuperjsonResponse({
      success: false,
      status: 'error',
      message: errorMessage,
      testedAt: new Date().toISOString(),
    } as TestConnectionResponse);
  }
}
