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
  type: 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT' | 'THINKING' | 'SYSTEM_MESSAGE' | 'LOCAL_SYSTEM_MESSAGE' | 'TOOL_APPROVAL_REQUEST';
  threadId: ThreadId;
  timestamp: string;
  data: any;
}

// Tool approval event data - extends what the agent emits
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input: unknown;  // Matches backend - not just Record<string, unknown>
  isReadOnly: boolean;
  // Additional metadata for UI
  toolDescription?: string;
  toolAnnotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    safeInternal?: boolean;
  };
  riskLevel: 'safe' | 'moderate' | 'destructive';
  timeout?: number;  // Seconds until auto-deny
}

// API request/response for approval decisions
export interface ToolApprovalResponse {
  requestId: string;
  decision: 'allow_once' | 'allow_session' | 'deny';
  reason?: string;
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