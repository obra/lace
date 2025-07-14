// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are child threads (sessionId.N) that run within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, CreateAgentRequest, Agent } from '@/types/api';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// Type guard for CreateAgentRequest
function isCreateAgentRequest(body: unknown): body is CreateAgentRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'name' in body &&
    typeof (body as { name: unknown }).name === 'string'
  );
}

// Type guard for ThreadId
function isValidThreadId(sessionId: string): sessionId is ThreadId {
  return typeof sessionId === 'string' && sessionId.length > 0;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    const sessionId = sessionIdParam;

    // Parse and validate request body
    const bodyData: unknown = await request.json();

    if (!isCreateAgentRequest(bodyData)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const body: CreateAgentRequest = bodyData;

    if (!body.name) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
    }

    const agent = await sessionService.spawnAgent(sessionId, body.name, body.provider, body.model);

    // Test SSE broadcast
    const { SSEManager } = await import('@/lib/sse-manager');
    const sseManager = SSEManager.getInstance();
    const agentThreadId = agent.threadId as ThreadId;
    const testEvent = {
      type: 'LOCAL_SYSTEM_MESSAGE' as const,
      threadId: agentThreadId,
      timestamp: new Date().toISOString(),
      data: { message: `Agent "${agent.name}" spawned successfully` },
    };
    sseManager.broadcast(sessionId, testEvent);

    return NextResponse.json({ agent }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error in POST /api/sessions/[sessionId]/agents:', error);

    if (isError(error) && error.message === 'Session not found') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    const sessionId = sessionIdParam;

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ agents: session.agents || [] });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]/agents:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
