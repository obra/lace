// ABOUTME: API endpoint for loading conversation history from database
// ABOUTME: Returns all previous messages and events for a session to enable conversation restoration

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { SessionEvent, ApiErrorResponse } from '@/types/api';
import type { ThreadEvent } from '@/lib/server/core-types';
import { asThreadId } from '@/lib/server/core-types';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';
import type { CompactionData } from '@/lib/core-types-import';

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

function safeGetToolResultData(
  data: unknown
): { content: Array<{ text?: string }>; id?: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if ('content' in obj && Array.isArray(obj.content)) {
    return {
      content: obj.content as Array<{ text?: string }>,
      id: typeof obj.id === 'string' ? obj.id : undefined,
    };
  }
  return null;
}

// Convert ThreadEvent to SessionEvent with proper type handling
function convertThreadEventToSessionEvent(threadEvent: ThreadEvent): SessionEvent {
  // Convert string threadId to ThreadId type
  const threadId = asThreadId(threadEvent.threadId);

  const baseEvent = {
    threadId,
    timestamp: threadEvent.timestamp,
  };

  switch (threadEvent.type) {
    case 'USER_MESSAGE': {
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'USER_MESSAGE',
        data: { content },
      };
    }

    case 'AGENT_MESSAGE': {
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'AGENT_MESSAGE',
        data: { content },
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
            toolName: toolCallData.name,
            input: toolCallData.arguments,
          },
        };
      } else {
        // Fallback for invalid tool call data
        return {
          ...baseEvent,
          type: 'TOOL_CALL',
          data: {
            toolName: 'unknown',
            input: {},
          },
        };
      }
    }

    case 'TOOL_RESULT': {
      // ThreadEvent.data is ToolResult for TOOL_RESULT events
      const toolResultData = safeGetToolResultData(threadEvent.data);
      if (toolResultData) {
        // Extract text content from the content blocks with proper type safety
        const resultContent = toolResultData.content
          .map((block: { text?: string }) => block.text ?? '')
          .join('');
        return {
          ...baseEvent,
          type: 'TOOL_RESULT',
          data: {
            toolName: toolResultData.id ?? 'unknown',
            result: resultContent,
          },
        };
      } else {
        // Fallback for invalid tool result data
        return {
          ...baseEvent,
          type: 'TOOL_RESULT',
          data: {
            toolName: 'unknown',
            result: String(threadEvent.data),
          },
        };
      }
    }

    case 'LOCAL_SYSTEM_MESSAGE': {
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { content },
      };
    }

    case 'COMPACTION': {
      // Convert CompactionData from core to web format
      const compactionData = threadEvent.data as CompactionData;
      return {
        ...baseEvent,
        type: 'COMPACTION',
        data: {
          strategyId: compactionData.strategyId,
          originalEventCount: compactionData.originalEventCount,
          compactedEvents: compactionData.compactedEvents,
          metadata: compactionData.metadata,
        },
      };
    }

    case 'SYSTEM_PROMPT': {
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'SYSTEM_PROMPT',
        data: { content },
      };
    }

    case 'USER_SYSTEM_PROMPT': {
      const content =
        typeof threadEvent.data === 'string' ? threadEvent.data : String(threadEvent.data);
      return {
        ...baseEvent,
        type: 'USER_SYSTEM_PROMPT',
        data: { content },
      };
    }

    case 'TOOL_APPROVAL_REQUEST': {
      // Convert persisted TOOL_APPROVAL_REQUEST event to SessionEvent format
      // Note: Persisted events only have minimal data (toolCallId), but SessionEvent expects rich data
      // We provide minimal fallback data to prevent UI errors
      const toolCallData = threadEvent.data as { toolCallId?: string } | string;
      const toolCallId = typeof toolCallData === 'object' && toolCallData?.toolCallId 
        ? toolCallData.toolCallId 
        : String(threadEvent.data);
      
      return {
        ...baseEvent,
        type: 'TOOL_APPROVAL_REQUEST',
        data: {
          requestId: toolCallId,
          toolName: 'unknown', // Not available in persisted data
          input: {},           // Not available in persisted data
          isReadOnly: false,   // Conservative default
          riskLevel: 'moderate' as const,
        },
      };
    }

    case 'TOOL_APPROVAL_RESPONSE': {
      // Convert persisted TOOL_APPROVAL_RESPONSE event to a generic SessionEvent
      // Since TOOL_APPROVAL_RESPONSE is not currently defined as a SessionEvent type,
      // we convert it to LOCAL_SYSTEM_MESSAGE for display
      const responseData = threadEvent.data as { toolCallId?: string; decision?: string } | string;
      const content = typeof responseData === 'object' && responseData 
        ? `Tool approval response: ${responseData.decision || 'unknown'} for call ${responseData.toolCallId || 'unknown'}`
        : `Tool approval response: ${String(threadEvent.data)}`;
      
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { content },
      };
    }

    default: {
      // Exhaustive check - this should never be reached if all event types are handled
      const _exhaustiveCheck: never = threadEvent.type;
      console.warn('Unknown event type encountered:', _exhaustiveCheck);
      // Return a fallback for runtime safety
      return {
        ...baseEvent,
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { content: `Unknown event type: ${String(_exhaustiveCheck)}` },
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
      const errorResponse: ApiErrorResponse = { error: 'Invalid session ID format' };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const sessionId = sessionIdParam;

    const sessionService = getSessionService();
    const session = await sessionService.getSession(asThreadId(sessionId));

    if (!session) {
      const errorResponse: ApiErrorResponse = { error: 'Session not found' };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Get the coordinator agent and load events through it (proper architecture)
    const coordinatorAgent = session.getAgent(asThreadId(sessionId));
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
