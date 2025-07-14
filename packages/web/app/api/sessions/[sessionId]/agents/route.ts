// ABOUTME: Agent spawning API endpoints for creating and listing agents within a session
// ABOUTME: Agents are child threads (sessionId.N) that run within a session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, CreateAgentRequest } from '@/types/api';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;
    const sessionId = sessionIdParam as ThreadId;

    // Parse request body
    const body: CreateAgentRequest = await request.json();
    
    if (!body.name) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
    }

    const agent = await sessionService.spawnAgent(
      sessionId,
      body.name,
      body.provider,
      body.model
    );

    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/sessions/[sessionId]/agents:', error);
    
    if (error instanceof Error && error.message === 'Session not found') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;
    const sessionId = sessionIdParam as ThreadId;

    const session = await sessionService.getSession(sessionId);
    
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ agents: session.agents });
  } catch (error) {
    console.error('Error in GET /api/sessions/[sessionId]/agents:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}