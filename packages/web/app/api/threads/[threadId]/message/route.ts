// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionService } from '@/lib/server/session-service';
import { MessageResponse, SessionEvent, ApiErrorResponse } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';
import { ThreadIdSchema, MessageRequestSchema } from '@/lib/validation/schemas';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
): Promise<NextResponse> {
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

    const threadId = threadIdResult.data;

    // Parse and validate request body with Zod
    const bodyRaw: unknown = await request.json();
    const bodyResult = MessageRequestSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      const errorResponse: ApiErrorResponse = {
        error: bodyResult.error.errors[0]?.message || 'Invalid request body',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const body = bodyResult.data;

    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionIdStr = threadId.includes('.') ? threadId.split('.')[0] : threadId;
    const sessionIdResult = ThreadIdSchema.safeParse(sessionIdStr);
    if (!sessionIdResult.success) {
      throw new Error('Invalid session ID derived from thread ID');
    }
    const sessionId = sessionIdResult.data;

    // Get agent instance
    const agent = sessionService.getAgent(threadId);

    if (!agent) {
      const errorResponse: ApiErrorResponse = { error: 'Agent not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Broadcast user message event via SSE
    const sseManager = SSEManager.getInstance();

    const userMessageEvent: SessionEvent = {
      type: 'USER_MESSAGE',
      threadId,
      timestamp: new Date().toISOString(),
      data: { content: body.message },
    };
    sseManager.broadcast(sessionId, userMessageEvent);

    // Generate message ID
    const messageId = randomUUID();

    // Process message asynchronously
    console.warn(`Processing message for agent ${threadId}: "${body.message}"`);
    agent
      .sendMessage(body.message)
      .then(() => {
        console.warn(`Message processing started for agent ${threadId}`);
      })
      .catch((error: unknown) => {
        console.error('Error processing message:', error);
        // Emit error event
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorEvent: SessionEvent = {
          type: 'LOCAL_SYSTEM_MESSAGE',
          threadId,
          timestamp: new Date().toISOString(),
          data: { message: `Error: ${errorMessage}` },
        };
        sseManager.broadcast(sessionId, errorEvent);
      });

    // Return immediate acknowledgment
    const response: MessageResponse = {
      status: 'accepted',
      threadId,
      messageId,
    };

    return NextResponse.json(response, { status: 202 });
  } catch (error: unknown) {
    console.error('Error in POST /api/threads/[threadId]/message:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
