// ABOUTME: API-specific types for web endpoints (requests, responses, models)
// ABOUTME: Imports shared event data from web-events.ts to avoid duplication

// Import core types that are used in this file
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

// Import shared event data types
import type { ToolApprovalRequestData } from './web-events';

// DESTROYED: API model types eliminated - using core types with superjson everywhere

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
  name?: string; // Made optional for default
  providerInstanceId: string;
  modelId: string;
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
  sessions: SessionInfo[];
}

export interface SessionResponse {
  session: SessionInfo;
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

// Project management types - using core types with superjson serialization
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
