// ABOUTME: Event stream types for real-time notifications
// ABOUTME: Supports both legacy LaceEvent and new AppEvent types during migration

import type { AppEvent } from '@lace/web/types/app-events';
import type { ProtocolEvent, PermissionRequestEvent } from '@lace/web/types/protocol-events';
import type { WebEvent } from '@lace/web/types/web-events';

// Web-specific connection state (not part of core events)
export interface StreamConnection {
  connected: boolean;
  lastEventId?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Subscription options for events
export interface StreamSubscription {
  threads?: string[]; // Filter to specific thread IDs (agent sessions)
  sessionIds?: string[]; // Filter by workspace session context
  projectIds?: string[]; // Filter by project context
  // New: AppEvent-specific filters
  protocolEventTypes?: string[]; // Filter protocol events by update type
  webEventTypes?: string[]; // Filter web events by type
}

/**
 * SSE message format sent to clients
 */
export interface SSEMessage {
  event: 'message' | 'error' | 'ping';
  data: AppEvent | { error: string } | { type: 'ping' };
}

/**
 * Event stream connection metadata (server-side)
 */
export interface EventStreamConnectionMeta {
  id: string;
  workspaceSessionId: string;
  agentSessionId?: string;
  projectId?: string;
  connectedAt: Date;
  lastEventAt?: Date;
}

/**
 * Re-export event types for convenience
 */
export type { AppEvent, ProtocolEvent, PermissionRequestEvent, WebEvent };
