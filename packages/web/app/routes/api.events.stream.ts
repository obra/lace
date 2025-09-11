// ABOUTME: Event stream endpoint for all real-time events
// ABOUTME: Multi-project, multi-session notifications via single stream

import { EventStreamManager } from '@/lib/event-stream-manager';
import { createErrorResponse } from '@/lib/server/api-utils';
import type { Route } from './+types/api.events.stream';

export async function loader({ request }: Route.LoaderArgs) {
  try {
    // Firehose approach: send ALL events, client-side filtering handles specificity
    const subscription = {};

    const manager = EventStreamManager.getInstance();

    // Create SSE stream
    let connectionId: string;

    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        // Add connection to manager with empty subscription (all events)
        connectionId = manager.addConnection(controller, subscription);

        // Handle connection cleanup
        request.signal?.addEventListener('abort', () => {
          manager.removeConnection(connectionId);
        });

        return connectionId;
      },

      cancel(_reason) {
        // Clean up connection when stream is cancelled (client disconnects)
        if (connectionId) {
          manager.removeConnection(connectionId);
        }
      },
    });

    // Return SSE response
    return new Response(stream, {
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
