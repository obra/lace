// ABOUTME: Shared event data structures used by both API and SSE streaming
// ABOUTME: Single source of truth for event payloads - no duplicates

import type { ToolResult, ToolAnnotations, ToolCall, ErrorType } from '@/types/core';
import type { CarouselItem, GoogleDocAttachment } from '@/types/design-system';

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
