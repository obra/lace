// ABOUTME: Type definitions for the web API endpoints
// ABOUTME: Defines interfaces for sessions, agents, and events

// Import core types from unified core imports
import type {
  ThreadId,
  ProviderInfo as BackendProviderInfo,
  ModelInfo as BackendModelInfo,
  AgentInfo,
  ThreadTokenUsage,
  ToolPolicy,
} from '@/types/core';

import type { ToolApprovalRequestData } from '@/types/web-events';

// Tool policy information structure
interface ToolPolicyInfo {
  value: ToolPolicy;
  allowedValues: ToolPolicy[];
  projectValue?: ToolPolicy;
  globalValue?: ToolPolicy;
}

// Session configuration interface
export interface SessionConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[] | Record<string, ToolPolicyInfo>; // Can be either array or policy info
  toolPolicies?: Record<string, ToolPolicy>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  availableTools?: string[];
  [key: string]: unknown;
}

// Configuration response from API endpoints
export interface ConfigurationResponse {
  configuration: SessionConfiguration;
}

// Tool approval types

export interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
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
