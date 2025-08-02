// ABOUTME: API-specific types for web endpoints (requests, responses, models)
// ABOUTME: Imports shared event data from web-events.ts to avoid duplication

// Import core types from unified core imports
import type {
  AgentState,
  ThreadId,
  AssigneeId,
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
  ProviderInfo as BackendProviderInfo,
  ModelInfo as BackendModelInfo,
} from '@/types/core';
import { ApprovalDecision } from '@/types/core';

// Import shared event data types
import type { ToolApprovalRequestData } from './web-events';

// Re-export imported types for convenience
export type { ThreadId, AssigneeId, AgentState, Task, TaskNote, TaskStatus, TaskPriority };
export { ApprovalDecision };

// API model types

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

// Tool approval types

// Multiple approval support - as defined in spec Phase 3.2
export interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: string;
  requestData: ToolApprovalRequestData;
}

// API request/response for approval decisions
export interface ToolApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  reason?: string;
}

// API request types

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

// API response types

export interface MessageResponse {
  status: 'accepted';
  threadId: ThreadId;
  messageId: string;
}

// Generic API response types for proper error handling
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
