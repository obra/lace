// ABOUTME: Event stream types for real-time notifications
// ABOUTME: Now uses LaceEvent directly - no StreamEvent wrapper

import type { LaceEvent } from '~/threads/types';

// Web-specific connection state (not part of core events)
export interface StreamConnection {
  connected: boolean;
  lastEventId?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Client-side event filtering for LaceEvents
interface EventFilter {
  shouldIncludeEvent: (event: LaceEvent) => boolean;
}

// Subscription options for LaceEvents
export interface StreamSubscription {
  threads?: string[]; // Filter to specific thread IDs
  sessionIds?: string[]; // Filter by session context
  projectIds?: string[]; // Filter by project context
}
