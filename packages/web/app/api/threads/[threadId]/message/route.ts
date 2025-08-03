// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionService } from '@/lib/server/session-service';
import { MessageResponse } from '@/types/api';
import type { SessionEvent } from '@/types/web-sse';
import { asThreadId, type ThreadId } from '@/types/core';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { ThreadIdSchema, MessageRequestSchema } from '@/lib/validation/schemas';
import { messageLimiter } from '@/lib/middleware/rate-limiter';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
): Promise<NextResponse> {
  // Apply rate limiting
  const rateLimitResponse = messageLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const sessionService = getSessionService();
    const { threadId: threadIdParam } = await params;

    // Validate thread ID with Zod
    const threadIdResult = ThreadIdSchema.safeParse(threadIdParam);
    if (!threadIdResult.success) {
      return createErrorResponse(
        threadIdResult.error.errors[0]?.message || 'Invalid thread ID format',
        400,
        { code: 'VALIDATION_FAILED' }
      );
    }

    // TypeScript now knows threadIdResult.success is true, so data is properly typed
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
    // ThreadId is a string, so we can safely use string methods
    const sessionIdStr: string = threadId.includes('.')
      ? (threadId.split('.')[0] ?? threadId)
      : threadId;

    const sessionIdResult = ThreadIdSchema.safeParse(sessionIdStr);
    if (!sessionIdResult.success) {
      throw new Error('Invalid session ID derived from thread ID');
    }
    // TypeScript now knows sessionIdResult.success is true, so data is properly typed
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

    // Broadcast user message event via SSE
    const sseManager = EventStreamManager.getInstance();

    const userMessageEvent: SessionEvent = {
      type: 'USER_MESSAGE' as const,
      threadId,
      timestamp: new Date().toISOString(),
      data: { content: body.message },
    };
    sseManager.broadcast({
      eventType: 'session',
      scope: { sessionId },
      data: userMessageEvent,
    });

    // Generate message ID
    const messageId = randomUUID();

    // Process message asynchronously

    agent
      .sendMessage(body.message)
      .then(() => {
        // Message processing started
      })
      .catch((error: unknown) => {
        // Emit error event
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorEvent: SessionEvent = {
          type: 'LOCAL_SYSTEM_MESSAGE' as const,
          threadId,
          timestamp: new Date().toISOString(),
          data: { content: `Error: ${errorMessage}` },
        };
        sseManager.broadcast({
          eventType: 'session',
          scope: { sessionId },
          data: errorEvent,
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
