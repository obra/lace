// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

// React Router v7 uses standard Response.json()
import { randomUUID } from 'crypto';
import { getSessionService } from '@/lib/server/session-service';
import { MessageResponse } from '@/types/api';
import { asThreadId, type ThreadId } from '@/types/core';
import { ThreadIdSchema, MessageRequestSchema } from '@/lib/validation/schemas';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { logger } from '~/utils/logger';
import type { Route } from './+types/api.threads.$threadId.message';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function action({ request, params }: Route.ActionArgs) {
  // Apply rate limiting - need to adapt this for RR7
  // const rateLimitResponse = messageLimiter(request);
  // if (rateLimitResponse) {
  //   return rateLimitResponse;
  // }

  try {
    const sessionService = getSessionService();
    const { threadId: threadIdParam } = params;

    // Validate thread ID with Zod
    const threadIdResult = ThreadIdSchema.safeParse(threadIdParam);
    if (!threadIdResult.success) {
      return createErrorResponse(
        threadIdResult.error.errors[0]?.message || 'Invalid thread ID format',
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    const threadId: ThreadId = asThreadId(threadIdResult.data);

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

    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionIdStr: string = threadId.includes('.')
      ? (threadId.split('.')[0] ?? threadId)
      : threadId;

    const sessionIdResult = ThreadIdSchema.safeParse(sessionIdStr);
    if (!sessionIdResult.success) {
      throw new Error('Invalid session ID derived from thread ID');
    }
    const sessionId: ThreadId = asThreadId(sessionIdResult.data);

    // Get agent instance through session
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    const agent = session.getAgent(threadId);

    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Generate message ID
    const messageId = randomUUID();

    // Process message asynchronously
    void agent.sendMessage(body.message).catch((error: unknown) => {
      logger.error('Message processing error', {
        threadId,
        sessionId,
        messageId,
        error: isError(error)
          ? { name: error.name, message: error.message }
          : { type: typeof error },
      });
    });

    // Return immediate acknowledgment
    const response: MessageResponse = {
      status: 'accepted' as const,
      threadId,
      messageId,
    };

    return createSuperjsonResponse(response, { status: 202 });
  } catch (error: unknown) {
    const errorMessage = isError(error) ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
