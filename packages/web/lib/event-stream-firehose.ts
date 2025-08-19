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
      this.disconnect();
    }
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  // Placeholder methods - will implement in next tasks
  private connect(): void {
    // TODO: Implement connection logic
  }

  private disconnect(): void {
    // TODO: Implement disconnection logic
  }
}

export { EventStreamFirehose };
export type { EventFilter, Subscription, ConnectionStats };
