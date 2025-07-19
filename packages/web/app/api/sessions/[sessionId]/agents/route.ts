// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are child threads (sessionId.N) that run within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { CreateAgentRequest } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';

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

// Type guard for ThreadId - validates and converts string to ThreadId
function isValidThreadId(sessionId: string): boolean {
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

    const sessionId = asThreadId(sessionIdParam);

    // Parse and validate request body
    const bodyData: unknown = await request.json();

    if (!isCreateAgentRequest(bodyData)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const body: CreateAgentRequest = bodyData;

    if (!body.name) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
    }

    // Get session and spawn agent directly
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const agent = session.spawnAgent(body.name, body.provider, body.model);

    // Setup agent approvals using utility
    const { setupAgentApprovals } = await import('@/lib/server/agent-utils');
    setupAgentApprovals(agent, sessionId);

    // Convert to API format
    const agentResponse = {
      threadId: agent.threadId,
      name: body.name,
      provider: body.provider || 'anthropic',
      model: body.model || 'claude-3-haiku-20240307',
      status: 'idle' as const,
      createdAt: new Date().toISOString(),
    };

    // Test SSE broadcast
    const { SSEManager } = await import('@/lib/sse-manager');
    const sseManager = SSEManager.getInstance();
    const testEvent = {
      type: 'LOCAL_SYSTEM_MESSAGE' as const,
      threadId: agentResponse.threadId,
      timestamp: new Date().toISOString(),
      data: { message: `Agent "${agentResponse.name}" spawned successfully` },
    };
    sseManager.broadcast(sessionId, testEvent);

    return NextResponse.json({ agent: agentResponse }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error in POST /api/sessions/[sessionId]/agents:', error);

    if (isError(error) && error.message === 'Session not found') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    const sessionId = asThreadId(sessionIdParam);

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get agents from Session instance
    const agents = session.getAgents();
    return NextResponse.json({
      agents: agents.map((agent) => {
        // Safely extract createdAt if available, otherwise use current timestamp
        const agentWithTimestamp = agent as unknown as { createdAt?: string };
        return {
          threadId: agent.threadId,
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          status: agent.status,
          createdAt: agentWithTimestamp.createdAt ?? new Date().toISOString(),
        };
      }),
    });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]/agents:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
