// ABOUTME: API endpoint for loading conversation history for a specific agent
// ABOUTME: Returns events only for the requested agent, enabling per-agent conversation views

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import type { LaceEvent } from '@/types/core';
import { asThreadId, isConversationEvent } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
): Promise<NextResponse> {
  try {
    const { agentId: agentIdParam } = await params;

    // Validate agent ID format
    if (!isValidThreadId(agentIdParam)) {
      return createErrorResponse('Invalid agent ID format', 400, { code: 'VALIDATION_FAILED' });
    }

    const agentId = asThreadId(agentIdParam);
    const sessionService = getSessionService();

    // For coordinator agents, agentId = sessionId
    // For delegate agents, agentId = sessionId.number
    let sessionId = agentId;
    if (agentId.includes('.')) {
      // Extract session ID from delegate agent ID (e.g., "session.1" -> "session")
      sessionId = asThreadId(agentId.split('.')[0]!);
    }

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      return createErrorResponse('Session not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get the specific agent
    const agent = session.getAgent(agentId);
    if (!agent) {
      return createErrorResponse('Agent not found', 404, { code: 'RESOURCE_NOT_FOUND' });
    }

    // Get events only for this specific agent
    const agentEvents = agent.getLaceEvents();

    // Filter to only conversation events (persisted and shown in timeline)
    const events: LaceEvent[] = agentEvents.filter((event): event is LaceEvent =>
      isConversationEvent(event.type)
    );

    return createSuperjsonResponse(events, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
