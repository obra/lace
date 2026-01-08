// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

// React Router v7 uses standard Response.json()
import { randomUUID } from 'crypto';
import { MessageResponse } from '@lace/web/types/api';
import { MessageRequestSchema } from '@lace/web/lib/validation/schemas';
import { createSuperjsonResponse } from '@lace/web/lib/server/serialization';
import { createErrorResponse } from '@lace/web/lib/server/api-utils';
import { logger } from '@lace/web/lib/logger';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { isAgentSessionId } from '@lace/web/lib/validation/session-id-validation';
import type { Route } from './+types/api.threads.$threadId.message';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function action({ request, params }: Route.ActionArgs) {
  // Add method guard
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  // Apply rate limiting - need to adapt this for RR7
  // const rateLimitResponse = messageLimiter(request);
  // if (rateLimitResponse) {
  //   return rateLimitResponse;
  // }

  try {
    const { threadId: threadIdParam } = params;

    // Supervisor-backed "threadId" is an agent protocol sessionId (opaque string)
    if (!threadIdParam || !isAgentSessionId(threadIdParam)) {
      return createErrorResponse('Invalid thread ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    // Parse and validate request body with Zod
    let bodyRaw: unknown;
    try {
      bodyRaw = await request.json();
    } catch (_error) {
      return createErrorResponse('Invalid JSON in request body', 400, {
        code: 'VALIDATION_FAILED',
      });
    }

    const bodyResult = MessageRequestSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      return createErrorResponse(
        bodyResult.error.errors[0]?.message || 'Invalid request body',
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    const body = bodyResult.data;

    const supervisor = await getSupervisor();
    const workspace = (await supervisor.listWorkspaceSessions()).find((ws) =>
      ws.agents.some((a) => a.sessionId === threadIdParam)
    );

    if (!workspace) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Generate message ID
    const messageId = randomUUID();

    // Process message asynchronously
    void supervisor
      .promptSession(workspace.workspaceSessionId, threadIdParam, [
        { type: 'text', text: body.message },
      ])
      .catch((error: unknown) => {
        logger.error('Message processing error', {
          threadId: threadIdParam,
          sessionId: workspace.workspaceSessionId,
          messageId,
          error: isError(error)
            ? { name: error.name, message: error.message }
            : { type: typeof error },
        });
      });

    // Return immediate acknowledgment
    const response: MessageResponse = {
      status: 'accepted' as const,
      threadId: threadIdParam,
      messageId,
    };

    return createSuperjsonResponse(response, { status: 202 });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
