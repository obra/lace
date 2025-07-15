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
type _SessionEventType =
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'THINKING'
  | 'LOCAL_SYSTEM_MESSAGE';

// Specific event data types
export interface UserMessageEventData {
  content: string;
  message?: string;
}

export interface AgentMessageEventData {
  content: string;
}

export interface ToolCallEventData {
  toolName: string;
  input: unknown;
}

export interface ToolResultEventData {
  toolName: string;
  result: unknown;
}

export interface ThinkingEventData {
  status: 'start' | 'complete';
}

export interface LocalSystemMessageEventData {
  message: string;
}

// Discriminated union for session events
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
      data: ToolResultEventData;
    }
  | {
      type: 'THINKING';
      threadId: ThreadId;
      timestamp: string;
      data: ThinkingEventData;
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
      data: { token: string };
    }
  | {
      type: 'AGENT_STREAMING';
      threadId: ThreadId;
      timestamp: string;
      data: { content: string };
    };

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

// API response types for proper error handling
export interface ApiSuccessResponse<T> {
  data?: T;
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Helper type guards for API responses
export function isApiError(response: unknown): response is ApiErrorResponse {
  return typeof response === 'object' && response !== null && 'error' in response;
}

export function isApiSuccess<T>(response: unknown): response is ApiSuccessResponse<T> {
  return typeof response === 'object' && response !== null && !('error' in response);
}

// Specific API response types
export interface SessionsResponse {
  sessions: Session[];
}

export interface SessionResponse {
  session: Session;
}

export interface AgentResponse {
  agent: Agent;
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
}

export interface ProviderInfo {
  type: string;
  name: string;
  models: ModelInfo[];
  available: boolean;
}

export interface ModelInfo {
  name: string;
  displayName: string;
  contextWindow: number;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
}
