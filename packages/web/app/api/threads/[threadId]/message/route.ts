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
  console.log('[MESSAGE_API] POST /api/threads/[threadId]/message called');

  // Apply rate limiting
  const rateLimitResponse = messageLimiter(request);
  if (rateLimitResponse) {
    console.log('[MESSAGE_API] Rate limit exceeded, returning error');
    return rateLimitResponse;
  }

  try {
    console.log('[MESSAGE_API] Getting session service and extracting threadId');
    const sessionService = getSessionService();
    const { threadId: threadIdParam } = await params;
    console.log('[MESSAGE_API] ThreadId param:', threadIdParam);

    // Validate thread ID with Zod
    console.log('[MESSAGE_API] Validating threadId with Zod schema');
    const threadIdResult = ThreadIdSchema.safeParse(threadIdParam);
    if (!threadIdResult.success) {
      console.log('[MESSAGE_API] ThreadId validation failed:', threadIdResult.error.errors);
      const errorResponse: ApiErrorResponse = {
        error: threadIdResult.error.errors[0]?.message || 'Invalid thread ID format',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // TypeScript now knows threadIdResult.success is true, so data is properly typed
    const threadId: ThreadId = asThreadId(threadIdResult.data);
    console.log('[MESSAGE_API] Valid threadId:', threadId);

    // Parse and validate request body with Zod
    console.log('[MESSAGE_API] Parsing request body JSON');
    let bodyRaw: unknown;
    try {
      bodyRaw = await request.json();
      console.log('[MESSAGE_API] Parsed body:', bodyRaw);
    } catch (_error) {
      console.log('[MESSAGE_API] Failed to parse JSON:', _error);
      const errorResponse: ApiErrorResponse = {
        error: 'Invalid JSON in request body',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    console.log('[MESSAGE_API] Validating message request schema');
    const bodyResult = MessageRequestSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      console.log('[MESSAGE_API] Message validation failed:', bodyResult.error.errors);
      const errorResponse: ApiErrorResponse = {
        error: bodyResult.error.errors[0]?.message || 'Invalid request body',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const body = bodyResult.data;
    console.log('[MESSAGE_API] Valid message body:', body);

    // Determine session ID (parent thread for agents, or self for sessions)
    // ThreadId is a string, so we can safely use string methods
    console.log('[MESSAGE_API] Determining session ID from threadId');
    const sessionIdStr: string = threadId.includes('.')
      ? (threadId.split('.')[0] ?? threadId)
      : threadId;
    console.log('[MESSAGE_API] Derived sessionId string:', sessionIdStr);

    const sessionIdResult = ThreadIdSchema.safeParse(sessionIdStr);
    if (!sessionIdResult.success) {
      console.log(
        '[MESSAGE_API] Invalid session ID derived from thread ID:',
        sessionIdResult.error.errors
      );
      throw new Error('Invalid session ID derived from thread ID');
    }
    // TypeScript now knows sessionIdResult.success is true, so data is properly typed
    const sessionId: ThreadId = asThreadId(sessionIdResult.data);
    console.log('[MESSAGE_API] Valid sessionId:', sessionId);

    // Get agent instance through session
    console.log('[MESSAGE_API] Getting session from sessionService');
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      console.log('[MESSAGE_API] Session not found for sessionId:', sessionId);
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }
    console.log('[MESSAGE_API] Session found, getting agent for threadId:', threadId);

    const agent = session.getAgent(threadId);

    if (!agent) {
      console.log('[MESSAGE_API] Agent not found for threadId:', threadId);
      console.log(
        '[MESSAGE_API] Available agents in session:',
        session.getAgents().map((a) => a.threadId)
      );
      const errorResponse: ApiErrorResponse = { error: 'Agent not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }
    console.log('[MESSAGE_API] Agent found:', {
      threadId: agent.threadId,
      name: agent.name,
      status: agent.status,
    });

    // Broadcast user message event via SSE
    console.log('[MESSAGE_API] Broadcasting user message event via SSE');
    const sseManager = EventStreamManager.getInstance();

    const userMessageEvent: SessionEvent = {
      type: 'USER_MESSAGE' as const,
      threadId,
      timestamp: new Date(),
      data: { content: body.message },
    };
    console.log('[MESSAGE_API] User message event:', userMessageEvent);
    sseManager.broadcastToSession(sessionId, userMessageEvent);
    console.log('[MESSAGE_API] SSE broadcast complete');

    // Generate message ID
    const messageId = randomUUID();
    console.log('[MESSAGE_API] Generated messageId:', messageId);

    // Process message asynchronously
    console.log('[MESSAGE_API] Starting async message processing');

    agent
      .sendMessage(body.message)
      .then(() => {
        console.log('[MESSAGE_API] Message processing started successfully');
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
        console.log('[MESSAGE_API] Broadcasting error event:', errorEvent);
        sseManager.broadcastToSession(sessionId, errorEvent);
      });

    // Return immediate acknowledgment
    console.log('[MESSAGE_API] Preparing response');
    const response: MessageResponse = {
      status: 'accepted' as const,
      threadId,
      messageId,
    };

    console.log('[MESSAGE_API] Returning response:', response);
    return NextResponse.json(response, { status: 202 });
  } catch (error: unknown) {
    console.error('[MESSAGE_API] Error in POST /api/threads/[threadId]/message:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
