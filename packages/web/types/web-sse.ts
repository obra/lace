// ABOUTME: Server-Sent Events (SSE) specific types for real-time event streaming
// ABOUTME: Defines SessionEvent union and UI-only event types for WebSocket/SSE communication

import type { ThreadEventType, ThreadId } from '@/types/core';
import { EVENT_TYPES } from '@/types/core';

// Import shared event data structures
import type {
  UserMessageEventData,
  AgentMessageEventData,
  ToolCallEventData,
  ToolAggregatedEventData,
  LocalSystemMessageEventData,
  SystemPromptEventData,
  UserSystemPromptEventData,
  CompactionEventData,
  ToolApprovalRequestData,
  ToolApprovalResponseData,
  AgentTokenData,
  AgentStreamingData,
} from './web-events';

// Import ToolResult for TOOL_RESULT events
import type { ToolResult } from '@/types/core';

// Re-export core event types for convenience
export { EVENT_TYPES, type ThreadEventType };

// UI-only event types (not persisted to database)
export const UI_EVENT_TYPES = [
  'TOOL_APPROVAL_REQUEST',
  'TOOL_APPROVAL_RESPONSE',
  'AGENT_TOKEN',
  'AGENT_STREAMING',
  'COMPACTION',
] as const;

export type UIEventType = (typeof UI_EVENT_TYPES)[number];

// Combined event types for SSE streaming
export type SessionEventType = ThreadEventType | UIEventType;

// Discriminated union for session events sent over SSE
// Note: timestamps are strings for JSON serialization over the wire
export type SessionEvent =
  | {
      type: 'USER_MESSAGE';
      threadId: ThreadId;
      timestamp: string;
      data: UserMessageEventData;
    }
  | {
      type: 'AGENT_MESSAGE';
      threadId: ThreadId;
      timestamp: string;
      data: AgentMessageEventData;
    }
  | {
      type: 'TOOL_CALL';
      threadId: ThreadId;
      timestamp: string;
      data: ToolCallEventData;
    }
  | {
      type: 'TOOL_RESULT';
      threadId: ThreadId;
      timestamp: string;
      data: ToolResult;
    }
  | {
      type: 'TOOL_AGGREGATED';
      threadId: ThreadId;
      timestamp: string;
      data: ToolAggregatedEventData;
    }
  | {
      type: 'LOCAL_SYSTEM_MESSAGE';
      threadId: ThreadId;
      timestamp: string;
      data: LocalSystemMessageEventData;
    }
  | {
      type: 'AGENT_TOKEN';
      threadId: ThreadId;
      timestamp: string;
      data: AgentTokenData;
    }
  | {
      type: 'AGENT_STREAMING';
      threadId: ThreadId;
      timestamp: string;
      data: AgentStreamingData;
    }
  | {
      type: 'TOOL_APPROVAL_REQUEST';
      threadId: ThreadId;
      timestamp: string;
      data: ToolApprovalRequestData;
    }
  | {
      type: 'SYSTEM_PROMPT';
      threadId: ThreadId;
      timestamp: string;
      data: SystemPromptEventData;
    }
  | {
      type: 'USER_SYSTEM_PROMPT';
      threadId: ThreadId;
      timestamp: string;
      data: UserSystemPromptEventData;
    }
  | {
      type: 'COMPACTION';
      threadId: ThreadId;
      timestamp: string;
      data: CompactionEventData;
    }
  | {
      type: 'TOOL_APPROVAL_RESPONSE';
      threadId: ThreadId;
      timestamp: string;
      data: ToolApprovalResponseData;
    };

// Utility functions
export function getAllEventTypes(): SessionEventType[] {
  return [...EVENT_TYPES, ...UI_EVENT_TYPES];
}

export function isPersistedEvent(type: SessionEventType): type is ThreadEventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

export function isUIOnlyEvent(type: SessionEventType): type is UIEventType {
  return (UI_EVENT_TYPES as readonly string[]).includes(type);
}
