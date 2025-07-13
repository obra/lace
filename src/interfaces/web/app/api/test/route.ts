// ABOUTME: Simple test API route for health checks and connectivity verification
// ABOUTME: Provides basic API endpoint testing without requiring Agent setup

import { NextRequest, NextResponse } from 'next/server';

interface RequestBody {
  message: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    return NextResponse.json({
      message: `Hello! You said: ${body.message}`,
      timestamp: new Date().toISOString(),
      apiVersion: '2.0',
      architecture: 'Agent-based event emitter pattern',
    });
  } catch {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    message: 'Lace Web API is running',
    timestamp: new Date().toISOString(),
    apiVersion: '2.0',
    architecture: 'Agent-based event emitter pattern',
    endpoints: {
      '/api/conversations': 'Non-streaming conversation API',
      '/api/conversations/stream': 'Streaming conversation API with SSE',
      '/api/tools': 'Tool management and execution API',
      '/api/threads': 'Thread/conversation management API',
      '/api/lace': 'Legacy compatibility endpoint',
      '/api/test': 'Health check and connectivity test',
    },
  });
}
