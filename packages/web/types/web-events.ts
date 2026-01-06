// ABOUTME: Shared event data structures used by both API and SSE streaming
// ABOUTME: Single source of truth for event payloads - no duplicates

import type { ToolResult, ToolAnnotations, ToolCall, ErrorType } from '@lace/web/types/core';
import type { CarouselItem, GoogleDocAttachment } from '@lace/web/types/design-system';

// Helper to derive origin from errorType
export function getErrorOrigin(errorType: ErrorType): 'agent' | 'tool' | 'provider' | 'system' {
  switch (errorType) {
    case 'tool_execution':
      return 'tool';
    case 'provider_failure':
    case 'timeout':
      return 'provider';
    case 'processing_error':
      return 'agent';
    default:
      return 'system';
  }
}

// Event data structures shared between API and SSE streaming
// These are the payloads contained within events, not the events themselves
// Note: USER_MESSAGE uses string directly, not an object wrapper

// NOTE: ToolCall is imported from core, replaces ToolCallEventData

export interface ToolAggregatedEventData {
  call: ToolCall;
  result?: ToolResult;
  toolName: string;
  toolId?: string;
  arguments?: unknown;
}

// Tool approval data structure - shared between API and SSE
// This is the extended UI version with all metadata needed for approval decisions
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input?: unknown; // Optional to match backend flexibility
  isReadOnly: boolean;
  // Additional metadata for UI presentation
  toolDescription?: string;
  toolAnnotations?: ToolAnnotations;
  riskLevel: 'safe' | 'moderate' | 'destructive';
}

// Timeline UI data structures
export interface TimelineEntry {
  id: string | number;
  type:
    | 'admin'
    | 'human'
    | 'ai'
    | 'tool'
    | 'integration'
    | 'carousel'
    | 'google-doc'
    | 'unknown'
    | 'system-prompt'
    | 'user-system-prompt'
    | 'error';
  content?: string;
  timestamp: Date;
  agent?: string;
  tool?: string;
  result?: ToolResult;
  action?: string;
  title?: string;
  description?: string;
  link?: string;
  items?: CarouselItem[];
  document?: GoogleDocAttachment;
  // Unknown event specific fields
  eventType?: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorEntry extends TimelineEntry {
  type: 'error';
  errorType: ErrorType;
  origin: 'agent' | 'tool' | 'provider' | 'system';
  message: string;
  context?: Record<string, unknown>;
  isRetryable: boolean;
  retryCount?: number;
  canRetry?: boolean;
  retryHandler?: () => void;
}

export interface AgentErrorLogEntry {
  id: string;
  timestamp: Date;
  errorType: ErrorType;
  origin: 'agent' | 'tool' | 'provider' | 'system';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  context: Record<string, unknown>;
  isRetryable: boolean;
  retryCount?: number;
  resolved: boolean;
  threadId?: string;
  sessionId?: string;
  providerName?: string;
  providerInstanceId?: string;
  modelId?: string;
}

/**
 * Web-internal event type identifiers
 */
export type WebEventType =
  | 'USER_MESSAGE_SENT'
  | 'AGENT_STATE_CHANGE'
  | 'AGENT_SPAWNED'
  | 'AGENT_SUMMARY_UPDATED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_DELETED'
  | 'SESSION_CREATED'
  | 'SESSION_UPDATED'
  | 'SESSION_DELETED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'SYSTEM_NOTIFICATION'
  | 'EVENT_UPDATED'
  | 'LOCAL_SYSTEM_MESSAGE'
  | 'TOOL_APPROVAL_RESPONSE';

/**
 * Base interface for web-internal events
 */
export interface WebEventBase {
  id: string;
  timestamp: Date;
  type: WebEventType;
  data: unknown;
  workspaceSessionId?: string;
  projectId?: string;
  agentSessionId?: string;
}

/** User sent a message to an agent */
export interface UserMessageSentEvent extends WebEventBase {
  type: 'USER_MESSAGE_SENT';
  data: {
    content: string;
    agentSessionId: string;
  };
}

/** Agent state changed (idle, thinking, streaming, etc.) */
export interface AgentStateChangeEvent extends WebEventBase {
  type: 'AGENT_STATE_CHANGE';
  data: {
    agentSessionId: string;
    previousState: string;
    newState: string;
  };
}

/** New agent was spawned (delegate, parallel task, etc.) */
export interface AgentSpawnedEvent extends WebEventBase {
  type: 'AGENT_SPAWNED';
  data: {
    agentSessionId: string;
    parentSessionId?: string;
    taskId?: string;
  };
}

/** Agent summary was updated (title, description) */
export interface AgentSummaryUpdatedEvent extends WebEventBase {
  type: 'AGENT_SUMMARY_UPDATED';
  data: {
    agentSessionId: string;
    summary: string;
  };
}

/** Project lifecycle events */
export interface ProjectCreatedEvent extends WebEventBase {
  type: 'PROJECT_CREATED';
  data: {
    projectId: string;
    name: string;
  };
}

export interface ProjectUpdatedEvent extends WebEventBase {
  type: 'PROJECT_UPDATED';
  data: {
    projectId: string;
    changes: Record<string, unknown>;
  };
}

export interface ProjectDeletedEvent extends WebEventBase {
  type: 'PROJECT_DELETED';
  data: {
    projectId: string;
  };
}

/** Session lifecycle events */
export interface SessionCreatedEvent extends WebEventBase {
  type: 'SESSION_CREATED';
  data: {
    sessionId: string;
    projectId: string;
  };
}

export interface SessionUpdatedEvent extends WebEventBase {
  type: 'SESSION_UPDATED';
  data: {
    sessionId: string;
    changes: Record<string, unknown>;
  };
}

export interface SessionDeletedEvent extends WebEventBase {
  type: 'SESSION_DELETED';
  data: {
    sessionId: string;
  };
}

/** Task lifecycle events */
export interface TaskCreatedEvent extends WebEventBase {
  type: 'TASK_CREATED';
  data: {
    taskId: string;
    sessionId: string;
  };
}

export interface TaskUpdatedEvent extends WebEventBase {
  type: 'TASK_UPDATED';
  data: {
    taskId: string;
    changes: Record<string, unknown>;
  };
}

export interface TaskDeletedEvent extends WebEventBase {
  type: 'TASK_DELETED';
  data: {
    taskId: string;
  };
}

/** System notification to display to user */
export interface SystemNotificationEvent extends WebEventBase {
  type: 'SYSTEM_NOTIFICATION';
  data: {
    message: string;
    level: 'info' | 'warning' | 'error' | 'success';
  };
}

/** An event was updated (edited, metadata changed) */
export interface EventUpdatedEvent extends WebEventBase {
  type: 'EVENT_UPDATED';
  data: {
    eventId: string;
    changes: Record<string, unknown>;
  };
}

/** Local system message (not from agent) */
export interface LocalSystemMessageEvent extends WebEventBase {
  type: 'LOCAL_SYSTEM_MESSAGE';
  data: {
    content: string;
    agentSessionId?: string;
  };
}

/** User responded to tool approval request */
export interface ToolApprovalResponseEvent extends WebEventBase {
  type: 'TOOL_APPROVAL_RESPONSE';
  data: {
    requestId: string;
    approved: boolean;
    optionId: string;
  };
}

/**
 * Discriminated union of all web event types
 */
export type WebEvent =
  | UserMessageSentEvent
  | AgentStateChangeEvent
  | AgentSpawnedEvent
  | AgentSummaryUpdatedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectDeletedEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskDeletedEvent
  | SystemNotificationEvent
  | EventUpdatedEvent
  | LocalSystemMessageEvent
  | ToolApprovalResponseEvent;
