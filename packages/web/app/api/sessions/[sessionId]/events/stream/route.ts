// ABOUTME: SSE stream endpoint for real-time event delivery within a session
// ABOUTME: Provides server-sent events for all agents within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId } from '@/types/api';
import { SSEManager } from '@/lib/sse-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;
    const sessionId = sessionIdParam as ThreadId;

    // Verify session exists
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const sseManager = SSEManager.getInstance();

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        const connectionEvent = {
          event: 'connection',
          data: JSON.stringify({
            sessionId,
            status: 'connected',
            timestamp: new Date().toISOString(),
          }),
        };

        // Send retry hint
        controller.enqueue(encoder.encode('retry: 3000\n\n'));

        // Send connection event
        controller.enqueue(
          encoder.encode(`event: ${connectionEvent.event}\ndata: ${connectionEvent.data}\n\n`)
        );

        // Register this stream with SSE manager
        sseManager.addConnection(sessionId, controller);

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
  } catch (error) {
    console.error('Error in GET /api/sessions/[sessionId]/events/stream:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
