// ABOUTME: API endpoint for sending messages to a supervisor-backed agent session
// ABOUTME: Agent ID is an Ent protocol sessionId; prompts are forwarded through supervisor

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { SupervisorHttpError } from '@lace/supervisor';
import { isAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import type { Route } from './+types/api.agents.$agentId.message';

const MessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { agentId } = params as { agentId: string };

    if (!isAgentSessionId(agentId)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return createErrorResponse('Unsupported Media Type', 415, { code: 'UNSUPPORTED_MEDIA_TYPE' });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return createErrorResponse('Invalid JSON', 400, { code: 'VALIDATION_FAILED' });
    }

    const parsedBody = MessageSchema.safeParse(body);
    if (!parsedBody.success) {
      return createErrorResponse('Invalid request body', 400, {
        code: 'VALIDATION_FAILED',
        details: parsedBody.error.errors,
      });
    }

    const supervisor = await getSupervisor();
    const workspace = (await supervisor.listWorkspaceSessions()).find((ws) =>
      ws.agents.some((a) => a.sessionId === agentId)
    );

    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const messageId = randomUUID();

    try {
      await supervisor.promptSession(workspace.workspaceSessionId, agentId, [
        { type: 'text', text: parsedBody.data.message },
      ]);
    } catch (error: unknown) {
      if (error instanceof SupervisorHttpError) {
        // Keep mapping simple: pass through upstream status + JSON-RPC error fields.
        return createSuperjsonResponse(
          {
            message: error.message,
            error: {
              code: error.code,
              message: error.message,
              data: error.data,
            },
          },
          { status: error.status }
        );
      }

      throw error;
    }

    return createSuperjsonResponse(
      { status: 'accepted' as const, threadId: agentId, messageId },
      { status: 200 }
    );
  } catch (error: unknown) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500,
      {
        code: 'INTERNAL_SERVER_ERROR',
      }
    );
  }
}
