// ABOUTME: Event stream endpoint for all real-time events
// ABOUTME: Multi-project, multi-session notifications via single stream

import { NextRequest, NextResponse } from 'next/server';
import { EventStreamManager } from '@/lib/event-stream-manager';
import type { StreamSubscription } from '@/types/stream-events';

// Parse subscription from query parameters
function parseSubscription(request: NextRequest): StreamSubscription {
  const url = new URL(request.url);
  
  return {
    projects: url.searchParams.get('projects')?.split(',').filter(Boolean),
    sessions: url.searchParams.get('sessions')?.split(',').filter(Boolean),
    threads: url.searchParams.get('threads')?.split(',').filter(Boolean),
    global: url.searchParams.get('global') === 'true',
    eventTypes: url.searchParams.get('eventTypes')?.split(',').filter(Boolean),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  console.log('[EVENT_STREAM] GET /api/events/stream called');
  
  try {
    const subscription = parseSubscription(request);
    console.log('[EVENT_STREAM] Subscription:', subscription);
    
    const manager = EventStreamManager.getInstance();
    
    // Create SSE stream
    const stream = new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array>) {
        console.log('[EVENT_STREAM] Starting stream');
        
        // Add connection to manager
        const connectionId = manager.addConnection(controller, subscription);
        
        // Handle connection cleanup
        request.signal?.addEventListener('abort', () => {
          console.log('[EVENT_STREAM] Client disconnected (abort signal)');
          manager.removeConnection(connectionId);
        });
        
        return connectionId;
      },
      
      cancel() {
        console.log('[EVENT_STREAM] Stream cancelled by client');
        // Connection cleanup is handled by abort listener
      }
    });

    // Return SSE response
    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });
    
  } catch (error) {
    console.error('[EVENT_STREAM] Error in GET /api/events/stream:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Health check endpoint
export async function HEAD(request: NextRequest): Promise<NextResponse> {
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