// ABOUTME: Session detail API endpoint for getting specific session information
// ABOUTME: Returns session metadata and list of agents within the session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { Session } from '@/lib/server/lace-imports';
import { ThreadId, ApiErrorResponse } from '@/types/api';
import { z } from 'zod';

// Type guard for ThreadId
function isValidThreadId(sessionId: string): sessionId is ThreadId {
  return typeof sessionId === 'string' && sessionId.length > 0;
}

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      const errorResponse: ApiErrorResponse = { error: 'Invalid session ID' };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const sessionId = sessionIdParam;

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Convert Session instance to metadata for JSON response
    const sessionInfo = session.getInfo();
    const agents = session.getAgents();

    const sessionData = {
      id: session.getId(),
      name: sessionInfo?.name ?? 'Unknown',
      createdAt: sessionInfo?.createdAt.toISOString() ?? new Date().toISOString(),
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: (agent as { createdAt?: string }).createdAt ?? new Date().toISOString(),
      })),
    };

    return NextResponse.json({ session: sessionData });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// Schema for validating session update requests
const UpdateSessionSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      const errorResponse: ApiErrorResponse = { error: 'Invalid session ID' };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const sessionId = sessionIdParam;

    // Check if session exists
    const existingSession = await sessionService.getSession(sessionId);
    if (!existingSession) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Parse and validate request body
    const bodyRaw: unknown = await request.json();
    const bodyResult = UpdateSessionSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      const errorResponse: ApiErrorResponse = {
        error: 'Invalid request data',
        details: bodyResult.error.errors,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const updates = bodyResult.data;

    // Update session metadata using the Session static method
    Session.updateSession(sessionId, {
      ...updates,
      updatedAt: new Date(),
    });

    // Clear the active sessions cache so the session gets reloaded from database with updated info
    sessionService.clearActiveSessions();

    // Get updated session data
    const updatedSession = await sessionService.getSession(sessionId);
    if (!updatedSession) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found after update' };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Convert to API response format
    // Get updated data from the sessions table
    const updatedSessionData = Session.getSession(sessionId);
    if (!updatedSessionData) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found after update' };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    const agents = updatedSession.getAgents();

    const sessionData = {
      id: updatedSession.getId(),
      name: updatedSessionData.name,
      description: updatedSessionData.description,
      status: updatedSessionData.status,
      createdAt: updatedSessionData.createdAt.toISOString(),
      agents: agents.map((agent) => ({
        threadId: agent.threadId,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        status: agent.status,
        createdAt: (agent as { createdAt?: string }).createdAt ?? new Date().toISOString(),
      })),
    };

    return NextResponse.json({ session: sessionData });
  } catch (error: unknown) {
    console.error('Error in PATCH /api/sessions/[sessionId]:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
