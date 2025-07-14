// ABOUTME: Session management API endpoints for creating and listing sessions
// ABOUTME: Sessions are parent threads that contain multiple agent threads

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { CreateSessionRequest } from '@/types/api';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const sessions = await sessionService.listSessions();

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Error in GET /api/sessions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const body: CreateSessionRequest = await request.json();

    const session = await sessionService.createSession(body.name);

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/sessions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
