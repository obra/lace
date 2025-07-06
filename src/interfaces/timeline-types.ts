// ABOUTME: Shared timeline types for timeline processing implementations
// ABOUTME: Provides common interfaces for Timeline, TimelineItem, and TimelineProcessor

import { ThreadEvent } from '../threads/types.js';
import { ToolCall, ToolResult } from '../tools/types.js';

export interface Timeline {
  items: TimelineItem[];
  metadata: {
    eventCount: number;
    messageCount: number;
    lastActivity: Date;
  };
}

export type TimelineItem =
  | { type: 'user_message'; content: string; timestamp: Date; id: string }
  | { type: 'agent_message'; content: string; timestamp: Date; id: string }
  | {
      type: 'tool_execution';
      call: ToolCall;
      result?: ToolResult;
      timestamp: Date;
      callId: string;
    }
  | {
      type: 'system_message';
      content: string;
      timestamp: Date;
      id: string;
      originalEventType?: string;
    }
  | { type: 'ephemeral_message'; messageType: string; content: string; timestamp: Date };

// Cached processed events (from persisted ThreadEvents)
export type ProcessedThreadItems = Exclude<TimelineItem, { type: 'ephemeral_message' }>[];

// Fast processing for streaming messages
export type EphemeralTimelineItems = Extract<TimelineItem, { type: 'ephemeral_message' }>[];

export interface EphemeralMessage {
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
}

export interface TimelineProcessor {
  // Incremental processing (O(1))
  appendEvent(event: ThreadEvent): void;
  
  // Bulk loading for session resumption (O(n))
  loadEvents(events: ThreadEvent[]): void;
  
  // State access
  getTimeline(): Timeline;
  reset(): void;
}