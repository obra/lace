// ABOUTME: Type definitions for thread events and thread management
// ABOUTME: Events include user messages, agent messages, tool calls, and tool results

import { ToolCall, ToolResult } from '~/tools/types';
import type { CompactionData } from '~/threads/compaction/types';
import type { ApprovalDecision } from '~/tools/approval-types';
import type { CombinedTokenUsage } from '~/token-management/types';

// Single source of truth for all event types
export const EVENT_TYPES = [
  // Persisted events
  'USER_MESSAGE',
  'AGENT_MESSAGE',
  'TOOL_CALL',
  'TOOL_APPROVAL_REQUEST',
  'TOOL_APPROVAL_RESPONSE',
  'TOOL_RESULT',
  'LOCAL_SYSTEM_MESSAGE',
  'SYSTEM_PROMPT',
  'USER_SYSTEM_PROMPT',
  'COMPACTION',
  // Transient events (not persisted to database)
  'AGENT_TOKEN',
  'AGENT_STREAMING',
  'AGENT_STATE_CHANGE',
  'COMPACTION_START',
  'COMPACTION_COMPLETE',
] as const;

// Derive ThreadEventType union from the array
export type ThreadEventType = (typeof EVENT_TYPES)[number];

// Tool approval event data types
export interface ToolApprovalRequestData {
  toolCallId: string;
}

export interface ToolApprovalResponseData {
  toolCallId: string;
  decision: ApprovalDecision;
}

// Base interface for common properties
interface BaseThreadEvent {
  id: string;
  threadId: string;
  timestamp: Date;
  // New fields for unified event system
  transient?: boolean; // If true, don't persist to database
  context?: {
    sessionId?: string;
    projectId?: string;
    taskId?: string;
    agentId?: string;
  };
}

// Agent message data with optional token usage
export interface AgentMessageData {
  content: string;
  tokenUsage?: CombinedTokenUsage;
}

// Data types for transient events
export interface AgentTokenData {
  token: string;
}

export interface AgentStreamingData {
  content: string;
}

export interface AgentStateChangeData {
  oldState: string;
  newState: string;
  reason?: string;
}

export interface CompactionStartData {
  auto: boolean;
}

export interface CompactionCompleteData {
  success: boolean;
  error?: string;
}

// Discriminated union for type-safe event handling
export type ThreadEvent =
  | (BaseThreadEvent & {
      type: 'USER_MESSAGE';
      data: string;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_MESSAGE';
      data: AgentMessageData;
    })
  | (BaseThreadEvent & {
      type: 'TOOL_CALL';
      data: ToolCall;
    })
  | (BaseThreadEvent & {
      type: 'TOOL_RESULT';
      data: ToolResult;
    })
  | (BaseThreadEvent & {
      type: 'TOOL_APPROVAL_REQUEST';
      data: ToolApprovalRequestData;
    })
  | (BaseThreadEvent & {
      type: 'TOOL_APPROVAL_RESPONSE';
      data: ToolApprovalResponseData;
    })
  | (BaseThreadEvent & {
      type: 'LOCAL_SYSTEM_MESSAGE';
      data: string;
    })
  | (BaseThreadEvent & {
      type: 'SYSTEM_PROMPT';
      data: string;
    })
  | (BaseThreadEvent & {
      type: 'USER_SYSTEM_PROMPT';
      data: string;
    })
  | (BaseThreadEvent & {
      type: 'COMPACTION';
      data: CompactionData;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_TOKEN';
      data: AgentTokenData;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_STREAMING';
      data: AgentStreamingData;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_STATE_CHANGE';
      data: AgentStateChangeData;
    })
  | (BaseThreadEvent & {
      type: 'COMPACTION_START';
      data: CompactionStartData;
    })
  | (BaseThreadEvent & {
      type: 'COMPACTION_COMPLETE';
      data: CompactionCompleteData;
    });

// Helper type to extract valid data types for addEvent method
export type ThreadEventData = ThreadEvent['data'];

export interface Thread {
  id: string;
  sessionId?: string;
  projectId?: string;
  createdAt: Date;
  updatedAt: Date;
  events: ThreadEvent[];
  metadata?: {
    name?: string;
    isSession?: boolean;
    provider?: string;
    model?: string;
    [key: string]: unknown;
  };
}

// Branded type for thread IDs
export type ThreadId = string & { readonly __brand: 'ThreadId' };

// Type guard
export function isThreadId(value: string): value is ThreadId {
  return /^lace_\d{8}_[a-z0-9]{6}(\.\d+)*$/.test(value);
}

// Constructor with validation
export function asThreadId(value: string): ThreadId {
  if (!isThreadId(value)) {
    throw new Error(`Invalid thread ID format: ${value}`);
  }
  return value;
}

// For new agent specifications
export type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };

export function isNewAgentSpec(value: string): value is NewAgentSpec {
  return /^new:([^/]+)\/(.+)$/.test(value);
}

export function createNewAgentSpec(provider: string, model: string): NewAgentSpec {
  return `new:${provider}/${model}` as NewAgentSpec;
}

// Unsafe cast for internal use only (e.g., when we know format is correct)
export function asNewAgentSpec(value: string): NewAgentSpec {
  return value as NewAgentSpec;
}

// Union type for task assignment
export type AssigneeId = ThreadId | NewAgentSpec | 'human';

export function isAssigneeId(value: string): value is AssigneeId {
  return isThreadId(value) || isNewAgentSpec(value) || value === 'human';
}

// Unsafe cast for internal use only (e.g., when we know format is correct)
export function asAssigneeId(value: string): AssigneeId {
  return value as AssigneeId;
}
