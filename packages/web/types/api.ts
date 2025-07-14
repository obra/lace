// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from Lace
export type { ThreadId } from '../../../../src/types/threads';

export interface Session {
  id: ThreadId;         // sessionId (parent threadId)
  name: string;
  createdAt: string;
  agents: Agent[];
}

export interface Agent {
  threadId: ThreadId;    // Full thread ID like sessionId.1
  name: string;
  provider: string;
  model: string;
  status: 'idle' | 'thinking' | 'streaming' | 'tool_execution';
  createdAt: string;
}

export interface SessionEvent {
  type: 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT' | 'THINKING' | 'SYSTEM_MESSAGE' | 'LOCAL_SYSTEM_MESSAGE';
  threadId: ThreadId;
  timestamp: string;
  data: any;
}

export interface MessageRequest {
  message: string;
}

export interface CreateSessionRequest {
  name?: string;
}

export interface CreateAgentRequest {
  name: string;
  provider?: string;
  model?: string;
}

export interface MessageResponse {
  status: 'accepted';
  threadId: ThreadId;
  messageId: string;
}