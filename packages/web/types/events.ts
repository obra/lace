// ABOUTME: Combined event type definitions for web interface
// ABOUTME: Consolidates events and event constants into single file

import type { EventType, ThreadId, ToolResult } from '@/lib/core';
import { EVENT_TYPES } from '@/lib/core';

// Re-export core event types
export { EVENT_TYPES, type EventType };

// UI-only event types (not persisted)
export const UI_EVENT_TYPES = [
  'TOOL_APPROVAL_REQUEST',
  'TOOL_APPROVAL_RESPONSE',
  'AGENT_TOKEN',
  'AGENT_STREAMING',
  'COMPACTION',
] as const;

export type UIEventType = (typeof UI_EVENT_TYPES)[number];

// Combined event types for SSE streaming
export type SessionEventType = EventType | UIEventType;

// Event data interfaces
export interface UserMessageEventData {
  content: string;
}

export interface AgentMessageEventData {
  content: string;
}

export interface ToolCallEventData {
  id: string;
  name: string;
  arguments?: unknown;
}

export interface ToolAggregatedEventData {
  call: ToolCallEventData;
  result?: ToolResult;
  toolName: string;
  toolId?: string;
  arguments?: unknown;
}

export interface LocalSystemMessageEventData {
  content: string;
}

export interface SystemPromptEventData {
  content: string;
}

export interface UserSystemPromptEventData {
  content: string;
}

export interface CompactionEventData {
  strategyId: string;
  originalEventCount: number;
  compactedEvents: unknown[]; // Array of events, kept as unknown for simplicity
  metadata?: Record<string, unknown>;
}

// ToolApprovalRequestData structure is defined inline to avoid circular dependencies

// Discriminated union for session events
export type SessionEvent =
  | {
      type: 'USER_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: UserMessageEventData;
    }
  | {
      type: 'AGENT_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: AgentMessageEventData;
    }
  | {
      type: 'TOOL_CALL';
      threadId: ThreadId;
      timestamp: Date;
      data: ToolCallEventData;
    }
  | {
      type: 'TOOL_RESULT';
      threadId: ThreadId;
      timestamp: Date;
      data: ToolResult;
    }
  | {
      type: 'TOOL_AGGREGATED';
      threadId: ThreadId;
      timestamp: Date;
      data: ToolAggregatedEventData;
    }
  | {
      type: 'LOCAL_SYSTEM_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: LocalSystemMessageEventData;
    }
  | {
      type: 'AGENT_TOKEN';
      threadId: ThreadId;
      timestamp: Date;
      data: { token: string };
    }
  | {
      type: 'AGENT_STREAMING';
      threadId: ThreadId;
      timestamp: Date;
      data: { content: string };
    }
  | {
      type: 'TOOL_APPROVAL_REQUEST';
      threadId: ThreadId;
      timestamp: Date;
      data: {
        requestId: string;
        toolName: string;
        input: unknown;
        isReadOnly: boolean;
        toolDescription?: string;
        toolAnnotations?: {
          title?: string;
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          safeInternal?: boolean;
        };
        riskLevel: 'safe' | 'moderate' | 'destructive';
      };
    }
  | {
      type: 'SYSTEM_PROMPT';
      threadId: ThreadId;
      timestamp: Date;
      data: SystemPromptEventData;
    }
  | {
      type: 'USER_SYSTEM_PROMPT';
      threadId: ThreadId;
      timestamp: Date;
      data: UserSystemPromptEventData;
    }
  | {
      type: 'COMPACTION';
      threadId: ThreadId;
      timestamp: Date;
      data: CompactionEventData;
    }
  | {
      type: 'TOOL_APPROVAL_RESPONSE';
      threadId: ThreadId;
      timestamp: Date;
      data: { toolCallId: string; decision: string };
    };

// Utility functions
export function getAllEventTypes(): SessionEventType[] {
  return [...EVENT_TYPES, ...UI_EVENT_TYPES];
}

export function isPersistedEvent(type: SessionEventType): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}
