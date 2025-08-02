// ABOUTME: Shared event data structures used by both API and SSE streaming
// ABOUTME: Single source of truth for event payloads - no duplicates

import type { ThreadEventType, ToolResult } from '@/types/core';

// Event data structures shared between API and SSE streaming
// These are the payloads contained within events, not the events themselves

export interface UserMessageEventData {
  content: string;
}

export interface AgentMessageEventData {
  content: string;
}

export interface ToolCallEventData {
  id: string;
  name: string;
  arguments?: unknown;
}

export interface ToolAggregatedEventData {
  call: ToolCallEventData;
  result?: ToolResult;
  toolName: string;
  toolId?: string;
  arguments?: unknown;
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

// Tool approval data structure - shared between API and SSE
// This is the extended UI version with all metadata needed for approval decisions
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input?: unknown; // Optional to match backend flexibility
  isReadOnly: boolean;
  // Additional metadata for UI presentation
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

// Simple data for approval response events
export interface ToolApprovalResponseData {
  toolCallId: string;
  decision: string;
}

// Streaming-specific event data
export interface AgentTokenData {
  token: string;
}

export interface AgentStreamingData {
  content: string;
}
