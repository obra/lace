// ABOUTME: API endpoint for loading conversation history from database
// ABOUTME: Returns all previous messages and events for a session to enable conversation restoration

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import type { LaceEvent } from '@/types/core';
import { asThreadId, isConversationEvent } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { sessionId: sessionIdParam } = await params;

    // Validate session ID format using client-safe validation that accepts both lace and UUID formats
    if (!isValidThreadId(sessionIdParam)) {
      return createErrorResponse('Invalid session ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const sessionId = sessionIdParam;

    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));

    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get the coordinator agent and load events through it (proper architecture)
    const coordinatorAgent = session.getAgent(asThreadId(sessionId));
    if (!coordinatorAgent) {
      return createErrorResponse('Could not access session coordinator', 500, {
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    // Load all events from the session and its delegates through the Agent layer
    const threadEvents = coordinatorAgent.getMainAndDelegateEvents(asThreadId(sessionId));

    // Filter to only conversation events (persisted and shown in timeline)
    const events: LaceEvent[] = threadEvents.filter((event): event is LaceEvent =>
      isConversationEvent(event.type)
    );

    return createSuperjsonResponse(events, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
