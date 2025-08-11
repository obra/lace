// ABOUTME: Event stream types for real-time notifications
// ABOUTME: Now uses ThreadEvent directly - no StreamEvent wrapper

import type { ThreadEvent } from '~/threads/types';

// Web-specific connection state (not part of core events)
export interface StreamConnection {
  connected: boolean;
  lastEventId?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

// Client-side event filtering for ThreadEvents
export interface EventFilter {
  shouldIncludeEvent: (event: ThreadEvent) => boolean;
}

// Subscription options for ThreadEvents
export interface StreamSubscription {
  threads?: string[]; // Filter to specific thread IDs
  sessionIds?: string[]; // Filter by session context
  projectIds?: string[]; // Filter by project context
}

export function createEventFilter(subscription: StreamSubscription): EventFilter {
  return {
    shouldIncludeEvent: (event: ThreadEvent) => {
      // Filter by thread ID
      if (subscription.threads && subscription.threads.length > 0) {
        if (!event.threadId || !subscription.threads.includes(event.threadId)) {
          return false;
        }
      }

      // Filter by session context
      if (subscription.sessionIds && subscription.sessionIds.length > 0) {
        if (
          !event.context?.sessionId ||
          !subscription.sessionIds.includes(event.context.sessionId)
        ) {
          return false;
        }
      }

      // Filter by project context
      if (subscription.projectIds && subscription.projectIds.length > 0) {
        if (
          !event.context?.projectId ||
          !subscription.projectIds.includes(event.context.projectId)
        ) {
          return false;
        }
      }

      return true;
    },
  };
}
