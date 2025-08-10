// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from unified core imports
import type {
  AgentState,
  ThreadId,
  ProviderInfo as BackendProviderInfo,
  ModelInfo as BackendModelInfo,
  SessionInfo,
  AgentInfo,
  ProjectInfo,
} from '@/types/core';
import { ApprovalDecision } from '@/types/core';

// Import only the types we actually use
import type { ToolApprovalRequestData } from './web-events';
import type { SessionEvent } from './web-sse';

// DESTROYED: API response types removed - using core types with superjson everywhere

// Tool approval types

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

// API request types

export interface MessageRequest {
  message: string;
}

export interface CreateSessionRequest {
  name?: string;
}

export interface CreateAgentRequest {
  name?: string;
  providerInstanceId: string; // REQUIRED - no fallback to old system
  modelId: string; // REQUIRED - no fallback to old system
}

// API response types

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

// Simple error response with optional code for better client-side error handling
export interface ApiErrorResponse {
  error: string;
  code?: string;
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

// Specific API response types - now using core types
export interface SessionsResponse {
  sessions: SessionInfo[];
}

export interface SessionResponse {
  session: SessionInfo;
}

export interface AgentResponse {
  agent: AgentInfo & {
    tokenUsage?: {
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalTokens: number;
      contextLimit: number;
      percentUsed: number;
      nearLimit: boolean;
    };
  };
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
}

export interface SessionHistoryResponse {
  events: SessionEvent[];
}

export interface PendingApprovalsResponse {
  pendingApprovals: PendingApproval[];
}

// Extend backend types with web-specific additions
export interface ProviderInfo extends BackendProviderInfo {
  models: ModelInfo[];
  configured: boolean;
  instanceId?: string; // ID of the configured provider instance
}

// Re-export backend ModelInfo directly - it matches what we need
export type ModelInfo = BackendModelInfo;

// Project management types - now using core types
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
