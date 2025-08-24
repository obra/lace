// ABOUTME: Event stream types for real-time notifications

// Web-specific connection state (not part of core events)
export interface StreamConnection {
  connected: boolean;
  lastEventId?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Subscription options for LaceEvents
export interface StreamSubscription {
  threads?: string[]; // Filter to specific thread IDs
  sessionIds?: string[]; // Filter by session context
  projectIds?: string[]; // Filter by project context
}
