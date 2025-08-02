// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from unified core imports
import type {
  AgentState,
  ThreadId,
  ProviderInfo as BackendProviderInfo,
  ModelInfo as BackendModelInfo,
} from '@/types/core';
import { ApprovalDecision } from '@/types/core';

// Import only the types we actually use
import type { ToolApprovalRequestData } from './web-events';

// API response types
// These represent the JSON-serialized format sent to clients
// Core types use Date objects, but these use ISO strings for JSON compatibility
// Prefixed with 'Api' to distinguish from core types

export interface ApiSession {
  id: string; // JSON-serialized ThreadId
  name: string;
  createdAt: string; // ISO string from Date serialization
  agentCount?: number; // Count of agents for list view
  agents?: ApiAgent[]; // Optional for list view, populated when session is selected
}

export interface ApiAgent {
  threadId: string; // JSON-serialized ThreadId
  name: string;
  provider: string;
  model: string;
  status: AgentState;
  createdAt: string; // ISO string from Date serialization
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
  sessions: ApiSession[];
}

export interface SessionResponse {
  session: ApiSession;
}

export interface AgentResponse {
  agent: ApiAgent;
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
export interface ApiProject {
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
  projects: ApiProject[];
}

export interface ProjectResponse {
  project: ApiProject;
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
