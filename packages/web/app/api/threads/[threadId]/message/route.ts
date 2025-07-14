// ABOUTME: Message sending API endpoint for sending messages to agent threads
// ABOUTME: Accepts messages, queues them for processing, and emits events via SSE

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, MessageRequest, MessageResponse, SessionEvent } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { threadId: threadIdParam } = await params;
    const threadId = threadIdParam as ThreadId;

    // Validate thread ID format
    if (!threadId.match(/^lace_\d{8}_[a-z0-9]+(\.\d+)?$/)) {
      return NextResponse.json({ error: 'Invalid thread ID format' }, { status: 400 });
    }

    // Parse request body
    const bodyRaw: unknown = await request.json();

    // Type-safe body validation
    if (!bodyRaw || typeof bodyRaw !== 'object' || !('message' in bodyRaw)) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const body = bodyRaw as MessageRequest;

    if (!body.message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (typeof body.message === 'string' && body.message.trim() === '') {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }

    // Determine session ID (parent thread for agents, or self for sessions)
    const sessionId = threadId.includes('.') ? (threadId.split('.')[0] as ThreadId) : threadId;

    // Get agent instance
    const agent = sessionService.getAgent(threadId);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
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
    console.info(`Processing message for agent ${threadId}: "${body.message}"`);
    agent
      .sendMessage(body.message)
      .then(() => {
        console.info(`Message processing started for agent ${threadId}`);
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
