// ABOUTME: EventStream Firehose Singleton - single EventSource connection with client-side filtering
// ABOUTME: Replaces per-component EventSource connections with shared firehose pattern

import type { LaceEvent } from '@/types/core';
import { parseTyped } from '@/lib/serialization';

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

  subscribe(filter: EventFilter, callback: (event: LaceEvent) => void): string {
    const subscriptionId = this.generateSubscriptionId();
    const subscription: Subscription = {
      id: subscriptionId,
      filter,
      callback,
      createdAt: new Date(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Start connection if this is the first subscription
    if (this.subscriptions.size === 1 && this.connectionState === 'disconnected') {
      this.connect();
    }

    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);

    // Disconnect if no subscriptions remain
    if (this.subscriptions.size === 0 && this.connectionState !== 'disconnected') {
      console.warn('[FIREHOSE] No subscriptions remaining, disconnecting...');
      this.disconnect();
    }
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  getSubscriptions(): ReadonlyMap<string, Subscription> {
    return new Map(this.subscriptions);
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

  private connect(): void {
    if (this.connectionState !== 'disconnected') {
      console.warn(
        '[FIREHOSE] Connect called but already connecting/connected:',
        this.connectionState
      );
      return; // Already connecting or connected
    }

    console.warn('[FIREHOSE] Connecting to event stream...');
    this.connectionState = 'connecting';

    // Firehose approach - no query parameters needed
    const url = '/api/events/stream';
    console.warn('[FIREHOSE] Creating EventSource for:', url);
    this.eventSource = new EventSource(url);

    this.setupEventSourceHandlers();
  }

  private disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connectionState = 'disconnected';

    if (process.env.NODE_ENV === 'development') {
      // Development debug info
    }
  }

  private setupEventSourceHandlers(): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      this.connectionState = 'connected';
    };

    this.eventSource.onmessage = (event) => {
      try {
        // Too verbose - comment out
        // console.log('[FIREHOSE] Received raw event:', event.data);
        this.handleIncomingEvent(event);
      } catch (error) {
        console.error('[FIREHOSE] Error handling event:', error);
      }
    };

    this.eventSource.onerror = (_error) => {
      if (this.connectionState === 'connected') {
        console.warn('[FIREHOSE] Connection lost');
      }
      this.connectionState = 'disconnected';
    };
  }

  private handleIncomingEvent(event: MessageEvent): void {
    this.eventsReceived++;

    try {
      // Parse the SuperJSON-serialized SSE event data
      const laceEvent = parseTyped<LaceEvent>(event.data as string);

      // Less verbose - only log important events (temporarily include AGENT_TOKEN for debugging)
      if (laceEvent.type !== 'AGENT_TOKEN') {
        console.warn('[FIREHOSE] Parsed:', laceEvent.type, laceEvent.threadId);
      } else {
        console.warn('[FIREHOSE] Parsed AGENT_TOKEN:', laceEvent.threadId);
      }

      this.routeEvent(laceEvent);
    } catch (error) {
      console.error('[FIREHOSE] Failed to parse event:', error, event.data);
    }
  }

  private routeEvent(event: LaceEvent): void {
    let routedCount = 0;
    // Only log routing for non-token events (temporarily include AGENT_TOKEN)
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[FIREHOSE] Routing',
        event.type,
        'to',
        this.subscriptions.size,
        'subscriptions'
      );
    }

    for (const subscription of this.subscriptions.values()) {
      const matches = this.eventMatchesFilter(event, subscription.filter);

      if (matches) {
        try {
          subscription.callback(event);
          routedCount++;
        } catch (error) {
          console.error('[FIREHOSE] Error in subscription callback:', error, {
            subscriptionId: subscription.id,
            eventId: event.id,
          });
          // Continue processing other subscriptions even if one fails
        }
      }
    }

    // Only log routing results for important events (temporarily include AGENT_TOKEN)
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FIREHOSE] Event routed to', routedCount, 'subscriptions');
    }

    if (process.env.NODE_ENV === 'development' && routedCount > 0) {
      // Development debug info for routing
    }
  }

  private eventMatchesFilter(event: LaceEvent, filter: EventFilter): boolean {
    // Empty filter matches everything
    if (
      !filter.threadIds?.length &&
      !filter.sessionIds?.length &&
      !filter.projectIds?.length &&
      !filter.eventTypes?.length
    ) {
      return true;
    }

    // Check thread ID filter
    if (filter.threadIds?.length && !filter.threadIds.includes(event.threadId)) {
      if (process.env.NODE_ENV === 'development' && event.type === 'AGENT_ERROR') {
        console.log('[FIREHOSE] AGENT_ERROR filtered out by threadId:', {
          eventThreadId: event.threadId,
          filterThreadIds: filter.threadIds,
        });
      }
      return false;
    }

    // Check session ID filter
    if (filter.sessionIds?.length) {
      if (!event.context?.sessionId || !filter.sessionIds.includes(event.context.sessionId)) {
        return false;
      }
    }

    // Check project ID filter
    if (filter.projectIds?.length) {
      if (!event.context?.projectId || !filter.projectIds.includes(event.context.projectId)) {
        return false;
      }
    }

    // Check event type filter
    if (filter.eventTypes?.length && !filter.eventTypes.includes(event.type)) {
      return false;
    }

    return true; // All specified filters passed
  }
}

export { EventStreamFirehose };
export type { EventFilter, Subscription, ConnectionStats };
