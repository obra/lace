// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from Lace
import type { AgentState, ThreadId, AssigneeId } from '@/lib/server/lace-imports';
import type {
  ProviderInfo as BackendProviderInfo,
  ModelInfo as BackendModelInfo,
} from '@/lib/server/core-types';

// Re-export imported types
export type { ThreadId, AssigneeId, AgentState };

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

// Task management types
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface TaskNote {
  id: string;
  author: ThreadId;
  content: string;
  timestamp: Date | string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  prompt: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: AssigneeId;
  createdBy: ThreadId;
  threadId: ThreadId;
  createdAt: Date | string;
  updatedAt: Date | string;
  notes: TaskNote[];
}

// Types for session events
type _SessionEventType =
  | 'USER_MESSAGE'
  | 'AGENT_MESSAGE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'THINKING'
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
      data: ToolResultEventData;
    }
  | {
      type: 'THINKING';
      threadId: ThreadId;
      timestamp: Date;
      data: ThinkingEventData;
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
