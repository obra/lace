// ABOUTME: Type definitions for thread events and thread management
// ABOUTME: Events include user messages, agent messages, tool calls, and tool results

import { ToolCall, ToolResult } from '../tools/types.js';

export type EventType =
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'LOCAL_SYSTEM_MESSAGE'
  | 'SYSTEM_PROMPT'
  | 'USER_SYSTEM_PROMPT';

export interface ThreadEvent {
  id: string;
  threadId: string;
  type: EventType;
  timestamp: Date;
  data: string | ToolCall | ToolResult;
}

export interface Thread {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  events: ThreadEvent[];
}

export interface VersionHistoryEntry {
  id: number;
  canonicalId: string;
  versionId: string;
  createdAt: Date;
  reason: string;
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
  return value as ThreadId;
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

// Union type for task assignment
export type AssigneeId = ThreadId | NewAgentSpec;

export function isAssigneeId(value: string): value is AssigneeId {
  return isThreadId(value) || isNewAgentSpec(value);
}
