// ABOUTME: Event stream types for real-time notifications
// ABOUTME: Multi-project, multi-session event streaming

import type { SessionEvent, ThreadId } from '@/types/api';
import type { TaskEvent } from '@/hooks/useTaskStream';

// Event scope for hierarchical filtering
export interface EventScope {
  projectId?: string;
  sessionId?: string;
  threadId?: string;
  global?: boolean;
}

// Project-level events
export interface ProjectEvent {
  type: 'project:created' | 'project:updated' | 'project:deleted';
  project: {
    id: string;
    name: string;
    description?: string;
  };
  context: {
    actor: string;
    isHuman?: boolean;
  };
}

// Global system events
export interface GlobalEvent {
  type: 'system:maintenance' | 'system:update' | 'system:notification';
  message: string;
  severity: 'info' | 'warning' | 'error';
  context: {
    actor: string;
    isHuman?: boolean;
  };
}

// Unified event wrapper
export interface StreamEvent {
  id: string;
  timestamp: Date;
  eventType: 'session' | 'task' | 'project' | 'global';
  scope: EventScope;
  data: SessionEvent | TaskEvent | ProjectEvent | GlobalEvent;
}

// Client-side subscription options
export interface StreamSubscription {
  projects?: string[];     // Filter to specific projects
  sessions?: string[];     // Filter to specific sessions
  threads?: string[];      // Filter to specific threads
  global?: boolean;        // Include global events
  eventTypes?: string[];   // Filter to specific event types
}

// Stream connection state
export interface StreamConnection {
  connected: boolean;
  lastEventId?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Event filter predicate
export type EventFilter = (event: StreamEvent) => boolean;

// Helper functions for event filtering
export function createEventFilter(subscription: StreamSubscription): EventFilter {
  return (event: StreamEvent) => {
    // Global events
    if (event.eventType === 'global') {
      return subscription.global === true;
    }

    // Project filtering
    if (subscription.projects && event.scope.projectId) {
      if (!subscription.projects.includes(event.scope.projectId)) {
        return false;
      }
    }

    // Session filtering
    if (subscription.sessions && event.scope.sessionId) {
      if (!subscription.sessions.includes(event.scope.sessionId)) {
        return false;
      }
    }

    // Thread filtering
    if (subscription.threads && event.scope.threadId) {
      if (!subscription.threads.includes(event.scope.threadId)) {
        return false;
      }
    }

    // Event type filtering
    if (subscription.eventTypes && subscription.eventTypes.length > 0) {
      const eventDataType = (event.data as { type?: string }).type;
      if (eventDataType && !subscription.eventTypes.includes(eventDataType)) {
        return false;
      }
    }

    return true;
  };
}

// Event scope helpers
export function isProjectEvent(event: StreamEvent): event is StreamEvent & { data: ProjectEvent } {
  return event.eventType === 'project';
}

export function isSessionEvent(event: StreamEvent): event is StreamEvent & { data: SessionEvent } {
  return event.eventType === 'session';
}

export function isTaskEvent(event: StreamEvent): event is StreamEvent & { data: TaskEvent } {
  return event.eventType === 'task';
}

export function isGlobalEvent(event: StreamEvent): event is StreamEvent & { data: GlobalEvent } {
  return event.eventType === 'global';
}