// ABOUTME: Event stream endpoint for all real-time events
// ABOUTME: Multi-project, multi-session notifications via single stream

import { NextRequest, NextResponse } from 'next/server';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { StreamSubscription } from '@/types/stream-events';

// Parse subscription from query parameters
function parseSubscription(request: NextRequest): StreamSubscription {
  const url = new URL(request.url);

  // Helper to parse comma-separated arrays, returning undefined for empty results
  const parseArrayParam = (param: string | null): string[] | undefined => {
    if (!param) return undefined;
    const filtered = param.split(',').filter(Boolean);
    return filtered.length > 0 ? filtered : undefined;
  };

  return {
    projectIds: parseArrayParam(url.searchParams.get('projects')),
    sessionIds: parseArrayParam(url.searchParams.get('sessions')),
    threads: parseArrayParam(url.searchParams.get('threads')),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const subscription = parseSubscription(request);

    const manager = EventStreamManager.getInstance();

    // Create SSE stream
    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        // Add connection to manager
        const connectionId = manager.addConnection(controller, subscription);

        // Handle connection cleanup
        request.signal?.addEventListener('abort', () => {
          manager.removeConnection(connectionId);
        });

        return connectionId;
      },

      cancel() {
        // Connection cleanup is handled by abort listener
      },
    });

    // Return SSE response
    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}

// Health check endpoint
export async function HEAD(_request: NextRequest): Promise<NextResponse> {
  const manager = EventStreamManager.getInstance();
  const stats = manager.getStats();

  return new NextResponse(null, {
    status: 200,
    headers: {
      'X-Connection-Count': stats.totalConnections.toString(),
      'X-Oldest-Connection': stats.oldestConnection?.toISOString() || 'none',
    },
  });
}
