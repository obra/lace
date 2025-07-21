// ABOUTME: SSE stream endpoint for real-time event delivery within a session
// ABOUTME: Provides server-sent events for all agents within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, ApiErrorResponse } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';

// Type guard for ThreadId
function isValidThreadId(sessionId: string): sessionId is ThreadId {
  return typeof sessionId === 'string' && sessionId.length > 0;
}

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      const errorResponse: ApiErrorResponse = { error: 'Invalid session ID' };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const sessionId = sessionIdParam;

    // Verify session exists
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const sseManager = SSEManager.getInstance();

    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        // Send initial connection event
        const connectionEvent = {
          event: 'connection',
          data: JSON.stringify({
            sessionId,
            status: 'connected',
            timestamp: new Date(),
          }),
        };

        // Send retry hint
        controller.enqueue(encoder.encode('retry: 3000\n\n'));

        // Send connection event
        controller.enqueue(
          encoder.encode(`event: ${connectionEvent.event}\ndata: ${connectionEvent.data}\n\n`)
        );

        // Register this stream with SSE manager
        try {
          sseManager.addConnection(sessionId, controller);
        } catch (error) {
          // Connection limit reached
          const errorMsg = error instanceof Error ? error.message : 'Connection limit reached';
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`)
          );
          controller.close();
          return;
        }

        // Send heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(':heartbeat\n\n'));
          } catch (_error) {
            // Stream might be closed
            clearInterval(heartbeat);
          }
        }, 30000);

        // Cleanup on close
        request.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          sseManager.removeConnection(sessionId, controller);
          controller.close();
        });
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]/events/stream:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
