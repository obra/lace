// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are child threads (sessionId.N) that run within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { CreateAgentRequest } from '@/types/api';
import { asThreadId, ThreadId } from '@/lib/server/core-types';
import { isValidThreadId as isClientValidThreadId } from '@/lib/validation/thread-id-validation';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// Type guard for CreateAgentRequest
function isCreateAgentRequest(body: unknown): body is CreateAgentRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    (!('name' in body) || typeof (body as { name: unknown }).name === 'string')
  );
}

// Type guard for ThreadId using client-safe validation
function isValidThreadId(sessionId: string): boolean {
  return isClientValidThreadId(sessionId);
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

    // Allow empty names - spawnAgent will provide default

    // Get session and spawn agent directly
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const agent = await session.spawnAgent(body.name || '', body.provider, body.model);

    // Setup agent approvals using utility
    const { setupAgentApprovals } = await import('@/lib/server/agent-utils');
    setupAgentApprovals(agent, sessionId);

    // Convert to API format - use agent's improved API
    const agentResponse = {
      threadId: agent.threadId,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      status: agent.status,
      createdAt: new Date().toISOString(),
    };

    // Test SSE broadcast
    const { EventStreamManager } = await import('@/lib/event-stream-manager');
    const sseManager = EventStreamManager.getInstance();
    const testEvent = {
      type: 'LOCAL_SYSTEM_MESSAGE' as const,
      threadId: agentResponse.threadId as ThreadId,
      timestamp: new Date(),
      data: { content: `Agent "${agentResponse.name}" spawned successfully` },
    };
    sseManager.broadcastToSession(sessionId, testEvent);

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
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: new Date().toISOString(),
      })),
    });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]/agents:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
