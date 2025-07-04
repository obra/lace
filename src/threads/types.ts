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
