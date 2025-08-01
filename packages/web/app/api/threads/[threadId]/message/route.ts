// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionService } from '@/lib/server/session-service';
import { MessageResponse, SessionEvent, ApiErrorResponse } from '@/types/api';
import { asThreadId, type ThreadId } from '@/lib/server/core-types';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { ThreadIdSchema, MessageRequestSchema } from '@/lib/validation/schemas';
import { messageLimiter } from '@/lib/middleware/rate-limiter';

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
      const errorResponse: ApiErrorResponse = {
        error: threadIdResult.error.errors[0]?.message || 'Invalid thread ID format',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // TypeScript now knows threadIdResult.success is true, so data is properly typed
    const threadId: ThreadId = asThreadId(threadIdResult.data);

    // Parse and validate request body with Zod
    let bodyRaw: unknown;
    try {
      bodyRaw = await request.json();
    } catch (_error) {
      const errorResponse: ApiErrorResponse = {
        error: 'Invalid JSON in request body',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const bodyResult = MessageRequestSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      const errorResponse: ApiErrorResponse = {
        error: bodyResult.error.errors[0]?.message || 'Invalid request body',
      };
      return NextResponse.json(errorResponse, { status: 400 });
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
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const agent = session.getAgent(threadId);

    if (!agent) {
      const errorResponse: ApiErrorResponse = { error: 'Agent not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Broadcast user message event via SSE
    const sseManager = EventStreamManager.getInstance();

    const userMessageEvent: SessionEvent = {
      type: 'USER_MESSAGE' as const,
      threadId,
      timestamp: new Date(),
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
        console.error('[MESSAGE_API] Error processing message:', error);
        // Emit error event
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorEvent: SessionEvent = {
          type: 'LOCAL_SYSTEM_MESSAGE' as const,
          threadId,
          timestamp: new Date(),
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

    return NextResponse.json(response, { status: 202 });
  } catch (error: unknown) {
    console.error('[MESSAGE_API] Error in POST /api/threads/[threadId]/message:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
