// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from unified core imports
import type {
  AgentState,
  ThreadId,
  AssigneeId,
  ToolResult,
  ProviderInfo as BackendProviderInfo,
  ModelInfo as BackendModelInfo,
} from '@/lib/core';
import { ApprovalDecision } from '@/lib/core';

// Re-export imported types
export type { ThreadId, AssigneeId, AgentState };
export { ApprovalDecision };

export interface Session {
  id: ThreadId; // sessionId (parent threadId)
  name: string;
  createdAt: string;
  agentCount?: number; // Count of agents for list view
  agents?: Agent[]; // Optional for list view, populated when session is selected
}

export interface Agent {
  threadId: ThreadId; // Full thread ID like sessionId.1
  name: string;
  provider: string;
  model: string;
  status: AgentState;
  createdAt: string;
}

// Task management types - re-exported from core
export type { Task, TaskNote, TaskStatus, TaskPriority } from '@/lib/core';

// Types for session events
type _SessionEventType =
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'TOOL_AGGREGATED'
  | 'LOCAL_SYSTEM_MESSAGE'
  | 'SYSTEM_PROMPT'
  | 'USER_SYSTEM_PROMPT';

// Specific event data types
export interface UserMessageEventData {
  content: string;
}

export interface AgentMessageEventData {
  content: string;
}

export interface ToolCallEventData {
  id: string;
  name: string;
  arguments: unknown;
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
      data: ToolApprovalRequestData;
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
}

// Multiple approval support - as defined in spec Phase 3.2
export interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
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
  name?: string; // Made optional for default
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

// Extend backend types with web-specific additions
export interface ProviderInfo extends BackendProviderInfo {
  models: ModelInfo[];
  configured: boolean;
}

// Re-export backend ModelInfo directly - it matches what we need
export type ModelInfo = BackendModelInfo;

// Project management types
export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  isArchived: boolean;
  createdAt: Date | string;
  lastUsedAt: Date | string;
  sessionCount?: number;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

export interface ProjectResponse {
  project: ProjectInfo;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  workingDirectory: string;
  configuration?: Record<string, unknown>;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  workingDirectory?: string;
  configuration?: Record<string, unknown>;
  isArchived?: boolean;
}

export interface DeleteProjectResponse {
  success: boolean;
}
