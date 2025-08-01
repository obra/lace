// ABOUTME: Web-specific request/response types that don't exist in core
// ABOUTME: Uses core types for data models, defines web request contracts from schemas

import { z } from 'zod';
import {
  MessageRequestSchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  CreateSessionRequestSchema,
  SpawnAgentRequestSchema,
  ToolCallIdSchema,
} from '@/lib/validation/schemas';

// Use core types for API responses - no duplication
export type { SessionInfo as Session } from '@/lib/core';

// Re-export core types
export type {
  ThreadId,
  AssigneeId,
  AgentState,
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
  ApprovalDecision,
  ToolResult,
} from '@/lib/core';

// Import types for explicit usage
import type { ThreadId, ApprovalDecision, Task } from '@/lib/core';

// Request types (inferred from validation schemas) - ONLY PLACE THESE EXIST
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;

// Response types (only if they don't exist in core)
export interface MessageResponse {
  status: 'accepted';
  threadId: ThreadId;
  messageId: string;
}

// Tool approval types
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input: unknown;
  isReadOnly: boolean;
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

export interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
}

export interface ToolApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  reason?: string;
}

// Generic API response types
export interface ApiSuccessResponse<T> {
  data?: T;
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Type guards
export function isApiError(response: unknown): response is ApiErrorResponse {
  return typeof response === 'object' && response !== null && 'error' in response;
}

export function isApiSuccess<T>(response: unknown): response is ApiSuccessResponse<T> {
  return typeof response === 'object' && response !== null && !('error' in response);
}

// Serialized task type (dates as strings for JSON transport)
export type SerializedTask = Omit<Task, 'createdAt' | 'updatedAt' | 'notes'> & {
  createdAt: string | undefined;
  updatedAt: string | undefined;
  notes: Array<Omit<Task['notes'][0], 'timestamp'> & { timestamp: string | undefined }>;
};
