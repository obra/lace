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
  ThreadTokenUsage,
} from '@/types/core';
import { ApprovalDecision } from '@/types/core';

// Import only the types we actually use
import type { ToolApprovalRequestData } from './web-events';
import type { LaceEvent } from '@/types/core';

// DESTROYED: API response types removed - using core types with superjson everywhere

// Session configuration interface
export interface SessionConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  [key: string]: unknown;
}

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
interface ToolApprovalResponse {
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
interface ApiSuccessResponse<T> {
  data?: T;
  [key: string]: unknown;
}

// Simple error response with optional code for better client-side error handling
export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Helper type guards for API responses
export function isApiError(response: unknown): response is ApiErrorResponse {
  return typeof response === 'object' && response !== null && 'error' in response;
}

export function isApiSuccess<T>(response: unknown): response is ApiSuccessResponse<T> {
  return typeof response === 'object' && response !== null && !('error' in response);
}

// Specific API response types - now using core types directly (no wrappers)

// Agent response now returns enhanced AgentInfo directly (no wrapper)

// Provider response now returns ProviderInfo[] directly (no wrapper)

// Session history and pending approvals now return arrays directly (no wrappers)

// Extend backend types with web-specific additions
export interface ProviderInfo extends BackendProviderInfo {
  models: ModelInfo[];
  configured: boolean;
  instanceId?: string; // ID of the configured provider instance
}

// Re-export backend ModelInfo directly - it matches what we need
export type ModelInfo = BackendModelInfo;

// Project management types - now using core types directly (no wrappers)

// Agent type with token usage for API responses
export type AgentWithTokenUsage = AgentInfo & {
  tokenUsage?: ThreadTokenUsage;
};
