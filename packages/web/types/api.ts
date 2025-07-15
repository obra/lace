// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from Lace
export type { ThreadId } from '@/lib/server/lace-imports';

// Define ApprovalDecision locally to avoid import issues
export const ApprovalDecision = {
  ALLOW_ONCE: 'allow_once',
  ALLOW_SESSION: 'allow_session',
  DENY: 'deny',
} as const;

export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export interface Session {
  id: ThreadId; // sessionId (parent threadId)
  name: string;
  createdAt: string;
  agents: Agent[];
}

import type { AgentState } from '@/lib/server/lace-imports';

export interface Agent {
  threadId: ThreadId; // Full thread ID like sessionId.1
  name: string;
  provider: string;
  model: string;
  status: AgentState;
  createdAt: string;
}

// Types for session events
type SessionEventType =
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'THINKING'
  | 'LOCAL_SYSTEM_MESSAGE';

export interface SessionEvent {
  type: SessionEventType;
  threadId: ThreadId;
  timestamp: string;
  data: unknown;
}

// Tool approval event data - extends what the agent emits
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input: unknown; // Matches backend - not just Record<string, unknown>
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
  timeout?: number; // Seconds until auto-deny
}

// API request/response for approval decisions
export interface ToolApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
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
