// ABOUTME: Type definitions for thread events and thread management
// ABOUTME: Events include user messages, agent messages, tool calls, and tool results

import { ToolCall, ToolResult } from '~/tools/types';
import type { CompactionData } from '~/threads/compaction/types';
import type { ApprovalDecision } from '~/tools/approval-types';

// Single source of truth for all event types
export const EVENT_TYPES = [
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
] as const;

// Derive EventType union from the array
export type EventType = (typeof EVENT_TYPES)[number];

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
}

// Discriminated union for type-safe event handling
export type ThreadEvent =
  | (BaseThreadEvent & {
      type: 'USER_MESSAGE';
      data: string;
    })
  | (BaseThreadEvent & {
      type: 'AGENT_MESSAGE';
      data: string;
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

// Constructor
export function createThreadId(value: string): ThreadId {
  if (!isThreadId(value)) {
    throw new Error(`Invalid thread ID format: ${value}`);
  }
  return value;
}

// Unsafe cast for internal use only (e.g., when we know format is correct)
export function asThreadId(value: string): ThreadId {
  return value as ThreadId;
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
