// ABOUTME: Legacy API route for backward compatibility using proper Agent service
// ABOUTME: Redirects to new conversation endpoints that use Agent event emitter pattern

import { NextRequest, NextResponse } from 'next/server';

interface RequestBody {
  message: string;
  threadId?: string;
}

/**
 * Legacy API endpoint for backward compatibility
 * Redirects to the new conversation endpoints that use Agent service properly
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    // Validate request
    if (!body.message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Get the base URL for internal API calls
    const baseUrl = new URL(request.url).origin;

    // Forward to the streaming conversation endpoint
    const streamResponse = await fetch(`${baseUrl}/api/conversations/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: body.message,
        threadId: body.threadId,
        provider: 'anthropic', // Default provider
      }),
    });

    if (!streamResponse.ok) {
      const errorData = await streamResponse.text();
      return NextResponse.json(
        { error: `Stream API error: ${errorData}` },
        { status: streamResponse.status }
      );
    }

    // Return the streaming response with proper headers
    return new Response(streamResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process request',
      },
      { status: 500 }
    );
  }
}

// Provide information about the API migration
export function GET(): NextResponse {
  return NextResponse.json({
    message: 'Legacy API endpoint',
    notice: 'This endpoint now uses Agent service instead of CLI wrapping',
    migration: {
      'For conversations':
        'Use /api/conversations for non-streaming or /api/conversations/stream for streaming',
      'For tools': 'Use /api/tools',
      'For thread management': 'Use /api/threads',
    },
    documentation:
      'All endpoints use proper Agent event emitter pattern for architecture compliance',
  });
}
