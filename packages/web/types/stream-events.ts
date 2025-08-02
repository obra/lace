// ABOUTME: Event stream types for real-time notifications
// ABOUTME: Clean re-export of core event types - no duplicate definitions

import type { StreamEvent, StreamSubscription } from '~/events/types';

// Re-export all core event types (single source of truth)
export type {
  EventType,
  EventScope,
  EventContext,
  StreamEvent,
  StreamSubscription,
  TaskEventData,
  AgentEventData,
  ProjectEventData,
  GlobalEventData,
  SessionEventData,
  createTaskEvent,
  createAgentEvent,
  createProjectEvent,
  createGlobalEvent,
  createSessionEvent,
  isTaskEvent,
  isAgentEvent,
  isProjectEvent,
  isGlobalEvent,
  isSessionEvent,
} from '~/events/types';

// Web-specific connection state (not part of core events)
export interface StreamConnection {
  connected: boolean;
  lastEventId?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Client-side event filtering
export interface EventFilter {
  shouldIncludeEvent: (event: StreamEvent) => boolean;
}

export function createEventFilter(subscription: StreamSubscription): EventFilter {
  return {
    shouldIncludeEvent: (event: StreamEvent) => {
      // Filter by event types
      if (subscription.eventTypes && subscription.eventTypes.length > 0) {
        if (!subscription.eventTypes.includes(event.eventType)) {
          return false;
        }
      }

      // Filter by project scope
      if (subscription.projects && subscription.projects.length > 0) {
        if (!event.scope.projectId || !subscription.projects.includes(event.scope.projectId)) {
          return false;
        }
      }

      // Filter by session scope
      if (subscription.sessions && subscription.sessions.length > 0) {
        if (!event.scope.sessionId || !subscription.sessions.includes(event.scope.sessionId)) {
          return false;
        }
      }

      // Filter by thread scope
      if (subscription.threads && subscription.threads.length > 0) {
        if (!event.scope.threadId || !subscription.threads.includes(event.scope.threadId)) {
          return false;
        }
      }

      // Include global events if requested
      if (subscription.global && event.scope.global) {
        return true;
      }

      return true;
    },
  };
}
