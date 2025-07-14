// ABOUTME: Session detail API endpoint for getting specific session information
// ABOUTME: Returns session metadata and list of agents within the session

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId } from '@/types/api';

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

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Error in GET /api/sessions/[sessionId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
