// ABOUTME: EventStream Firehose Singleton - single EventSource connection with client-side filtering
// ABOUTME: Replaces per-component EventSource connections with shared firehose pattern

import type { LaceEvent } from '@/types/core';

interface EventFilter {
  threadIds?: string[];
  sessionIds?: string[];
  projectIds?: string[];
  eventTypes?: string[];
}

interface Subscription {
  id: string;
  filter: EventFilter;
  callback: (event: LaceEvent) => void;
  createdAt: Date;
}

interface ConnectionStats {
  isConnected: boolean;
  subscriptionCount: number;
  connectionUrl: string | null;
  connectedAt: Date | null;
  eventsReceived: number;
}

class EventStreamFirehose {
  private static instance: EventStreamFirehose | null = null;
  private eventSource: EventSource | null = null;
  private subscriptions: Map<string, Subscription> = new Map();
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private eventsReceived: number = 0;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): EventStreamFirehose {
    if (!EventStreamFirehose.instance) {
      EventStreamFirehose.instance = new EventStreamFirehose();
    }
    return EventStreamFirehose.instance;
  }

  getStats(): ConnectionStats {
    return {
      isConnected: this.connectionState === 'connected',
      subscriptionCount: this.subscriptions.size,
      connectionUrl: this.eventSource?.url || null,
      connectedAt: null, // Will implement in later task
      eventsReceived: this.eventsReceived,
    };
  }
}

export { EventStreamFirehose };
export type { EventFilter, Subscription, ConnectionStats };
