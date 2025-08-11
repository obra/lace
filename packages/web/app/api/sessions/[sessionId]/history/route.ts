// ABOUTME: API endpoint for loading conversation history from database
// ABOUTME: Returns all previous messages and events for a session to enable conversation restoration

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import type { SessionEvent } from '@/types/web-sse';
import type { ThreadEvent, ToolResult } from '@/types/core';
import { asThreadId, isTransientEventType } from '@/types/core';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';

function isToolResult(data: unknown): data is ToolResult {
  return (
    typeof data === 'object' &&
    data !== null &&
    'content' in data &&
    Array.isArray((data as { content: unknown }).content)
  );
}

// Use core ThreadId validation instead of custom validation
// isThreadId is imported from core-types and handles proper format validation

// Safe property access functions that handle unknown types
function safeGetToolCallData(
  data: unknown
): { name: string; arguments: Record<string, unknown> } | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  // Handle both formats: { name, arguments } and { toolName, input }
  if ('name' in obj && 'arguments' in obj && typeof obj.name === 'string') {
    const args = obj.arguments;
    return {
      name: obj.name,
      arguments: (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>,
    };
  } else if ('toolName' in obj && typeof obj.toolName === 'string') {
    const input = 'input' in obj ? obj.input : {};
    return {
      name: obj.toolName,
      arguments: (typeof input === 'object' && input !== null ? input : {}) as Record<
        string,
        unknown
      >,
    };
  }
  return null;
}

// Convert ThreadEvent to SessionEvent with proper type handling
function convertThreadEventToSessionEvent(threadEvent: ThreadEvent): SessionEvent | null {
  // Skip transient events - they're not included in history
  if (isTransientEventType(threadEvent.type)) {
    return null;
  }

  // Convert string threadId to ThreadId type
  const threadId = asThreadId(threadEvent.threadId);

  const baseEvent = {
    threadId,
    timestamp:
      threadEvent.timestamp instanceof Date
        ? threadEvent.timestamp
        : new Date(threadEvent.timestamp || new Date()),
  };

  switch (threadEvent.type) {
    case 'USER_MESSAGE': {
      // USER_MESSAGE data is a string directly, not wrapped in an object
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'USER_MESSAGE',
        data: content,
      };
    }

    case 'AGENT_MESSAGE': {
      return {
        ...baseEvent,
        type: 'AGENT_MESSAGE',
        data: threadEvent.data,
      };
    }

    case 'TOOL_CALL': {
      // ThreadEvent.data is ToolCall for TOOL_CALL events
      const toolCallData = safeGetToolCallData(threadEvent.data);
      if (toolCallData) {
        return {
          ...baseEvent,
          type: 'TOOL_CALL',
          data: {
            id: threadEvent.id || '',
            name: toolCallData.name,
            arguments: toolCallData.arguments,
          },
        };
      } else {
        // Fallback for invalid tool call data
        return {
          ...baseEvent,
          type: 'TOOL_CALL',
          data: {
            id: threadEvent.id || '',
            name: 'unknown',
            arguments: {},
          },
        };
      }
    }

    case 'TOOL_RESULT': {
      // ThreadEvent.data should be ToolResult for TOOL_RESULT events
      if (isToolResult(threadEvent.data)) {
        return {
          ...baseEvent,
          type: 'TOOL_RESULT',
          data: threadEvent.data,
        };
      }
      // Skip malformed TOOL_RESULT events
      return null;
    }

    case 'LOCAL_SYSTEM_MESSAGE': {
      // LOCAL_SYSTEM_MESSAGE data is a string directly
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: content,
      };
    }

    case 'COMPACTION': {
      // With discriminated union, TypeScript knows threadEvent.data is CompactionData
      return {
        ...baseEvent,
        type: 'COMPACTION',
        data: {
          strategyId: threadEvent.data.strategyId,
          originalEventCount: threadEvent.data.originalEventCount,
          compactedEvents: threadEvent.data.compactedEvents,
          metadata: threadEvent.data.metadata,
        },
      };
    }

    case 'SYSTEM_PROMPT': {
      // SYSTEM_PROMPT data is a string directly
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'SYSTEM_PROMPT',
        data: content,
      };
    }

    case 'USER_SYSTEM_PROMPT': {
      // USER_SYSTEM_PROMPT data is a string directly
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'USER_SYSTEM_PROMPT',
        data: content,
      };
    }

    case 'TOOL_APPROVAL_REQUEST':
    case 'TOOL_APPROVAL_RESPONSE':
      // Don't include approval events in timeline - they're for internal approval flow only
      return null;

    default: {
      // TypeScript exhaustiveness check - cast to access type property
      const unknownEvent = threadEvent as { type: string };
      // Return a fallback for runtime safety
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: `Unknown event type: ${unknownEvent.type}`,
      } as SessionEvent;
    }
  }
}

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
    const threadEvents = coordinatorAgent.getMainAndDelegateEvents(sessionId);

    // Convert ThreadEvent to SessionEvent and filter out null values (approval events)
    const events: SessionEvent[] = threadEvents
      .map(convertThreadEventToSessionEvent)
      .filter((event): event is SessionEvent => event !== null);

    return createSuperjsonResponse({ events }, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return createErrorResponse(errorMessage, 500, { code: 'INTERNAL_SERVER_ERROR', error });
  }
}
