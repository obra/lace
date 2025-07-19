// ABOUTME: API endpoint for loading conversation history from database
// ABOUTME: Returns all previous messages and events for a session to enable conversation restoration

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ThreadId, SessionEvent, ApiErrorResponse } from '@/types/api';
import type { ThreadEvent } from '@/lib/server/core-types';

// Type guard for ThreadId
function isValidThreadId(threadId: string): threadId is ThreadId {
  return typeof threadId === 'string' && threadId.length > 0;
}

// Convert ThreadEvent to SessionEvent
function convertThreadEventToSessionEvent(threadEvent: ThreadEvent): SessionEvent {
  const baseEvent = {
    threadId: threadEvent.threadId as ThreadId,
    timestamp: threadEvent.timestamp.toISOString(),
  };

  switch (threadEvent.type) {
    case 'USER_MESSAGE':
      return {
        ...baseEvent,
        type: 'USER_MESSAGE',
        data: { content: threadEvent.data as string },
      };

    case 'AGENT_MESSAGE':
      return {
        ...baseEvent,
        type: 'AGENT_MESSAGE',
        data: { content: threadEvent.data as string },
      };

    case 'TOOL_CALL': {
      const toolCall = threadEvent.data as {
        toolName?: string;
        name?: string;
        input?: unknown;
        args?: unknown;
      };
      return {
        ...baseEvent,
        type: 'TOOL_CALL',
        data: {
          toolName: toolCall.toolName || toolCall.name || '',
          input: toolCall.input || toolCall.args || {},
        },
      };
    }

    case 'TOOL_RESULT': {
      const toolResult = threadEvent.data as {
        toolName?: string;
        name?: string;
        result?: unknown;
        content?: unknown;
      };
      return {
        ...baseEvent,
        type: 'TOOL_RESULT',
        data: {
          toolName: toolResult.toolName || toolResult.name || '',
          result: toolResult.result || toolResult.content || '',
        },
      };
    }

    case 'LOCAL_SYSTEM_MESSAGE':
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { message: threadEvent.data as string },
      };

    default:
      // For unknown event types, return a generic system message
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { message: `Unknown event: ${threadEvent.type}` },
      };
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const { sessionId: sessionIdParam } = await params;

    if (!isValidThreadId(sessionIdParam)) {
      const errorResponse: ApiErrorResponse = { error: 'Invalid session ID' };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const sessionId = sessionIdParam;

    // Validate session ID format
    if (!sessionId.match(/^lace_\d{8}_[a-z0-9]+$/)) {
      const errorResponse: ApiErrorResponse = { error: 'Invalid session ID format' };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const sessionService = getSessionService();
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Get the coordinator agent and load events through it (proper architecture)
    const coordinatorAgent = session.getAgent(sessionId);
    if (!coordinatorAgent) {
      const errorResponse: ApiErrorResponse = { error: 'Could not access session coordinator' };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Load all events from the session and its delegates through the Agent layer
    const threadEvents = coordinatorAgent.getMainAndDelegateEvents(sessionId);

    // Convert ThreadEvent to SessionEvent
    const events: SessionEvent[] = threadEvents.map(convertThreadEventToSessionEvent);

    return NextResponse.json({ events }, { status: 200 });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions/[sessionId]/history:', error);

    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
