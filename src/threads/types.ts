// ABOUTME: Type definitions for thread events and thread management
// ABOUTME: Events include user messages, agent messages, tool calls, and tool results

export type EventType =
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'LOCAL_SYSTEM_MESSAGE'
  | 'THINKING';

export interface ThreadEvent {
  id: string;
  threadId: string;
  type: EventType;
  timestamp: Date;
  data: string | ToolCallData | ToolResultData;
}

export interface ToolCallData {
  toolName: string;
  input: Record<string, unknown>;
  callId: string;
}

export interface ToolResultData {
  callId: string;
  output: string;
  success: boolean;
  error?: string;
}

export interface Thread {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  events: ThreadEvent[];
}
