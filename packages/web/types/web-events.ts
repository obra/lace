// ABOUTME: Shared event data structures used by both API and SSE streaming
// ABOUTME: Single source of truth for event payloads - no duplicates

import type {
  LaceEventType,
  ToolResult,
  AgentMessageData,
  ToolAnnotations,
  ToolCall,
} from '@/types/core';
import type { CarouselItem, GoogleDocAttachment } from '@/types/design-system';

// Event data structures shared between API and SSE streaming
// These are the payloads contained within events, not the events themselves
// Note: USER_MESSAGE uses string directly, not an object wrapper

// NOTE: AgentMessageData is imported from core, replaces AgentMessageEventData

// NOTE: ToolCall is imported from core, replaces ToolCallEventData

export interface ToolAggregatedEventData {
  call: ToolCall;
  result?: ToolResult;
  toolName: string;
  toolId?: string;
  arguments?: unknown;
}

// Note: LOCAL_SYSTEM_MESSAGE, SYSTEM_PROMPT, and USER_SYSTEM_PROMPT
// use string data directly, not wrapped in objects

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
  toolAnnotations?: ToolAnnotations;
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
    | 'user-system-prompt';
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
