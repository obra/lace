// ABOUTME: Session detail API endpoint for getting specific session information
// ABOUTME: Returns session metadata and list of agents within the session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, ApiErrorResponse } from '@/types/api';

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

    return NextResponse.json({ session });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
