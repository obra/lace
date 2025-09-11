// ABOUTME: Zustand store for managing single SSE connection across entire app
// ABOUTME: Replaces EventStreamFirehose singleton with proper React state management

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { LaceEvent } from '@/types/core';
import { parseTyped } from '@/lib/serialization';

interface EventFilter {
  threadIds?: string[];
  sessionIds?: string[];
  projectIds?: string[];
  eventTypes?: string[];
}

interface EventSubscription {
  id: string;
  filter: EventFilter;
  callback: (event: LaceEvent) => void;
  createdAt: Date;
}

interface SSEState {
  // Connection state only - no event caching
  eventSource: EventSource | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastConnectedAt: Date | null;

  // Subscription management
  subscriptions: Map<string, EventSubscription>;

  // Connection lifecycle only
  reconnectAttempts: number;
  lastError?: Error;

  // Debouncing for React Strict Mode
  disconnectTimeout: NodeJS.Timeout | null;
}

interface SSEActions {
  // Subscription management
  subscribe: (filter: EventFilter, callback: (event: LaceEvent) => void) => string;
  unsubscribe: (subscriptionId: string) => void;

  // Connection management
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;

  // Connection status only
  getConnectionStats: () => {
    isConnected: boolean;
    subscriptionCount: number;
    connectionUrl: string | null;
    connectedAt: Date | null;
  };
}

// Helper function to check if event matches filter
function eventMatchesFilter(event: LaceEvent, filter: EventFilter): boolean {
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
  if (filter.threadIds?.length) {
    const eventThreadId = event.context?.threadId;
    if (!eventThreadId || !filter.threadIds.includes(eventThreadId)) {
      return false;
    }
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

  return true;
}

// Generate unique subscription IDs
function generateSubscriptionId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// Create the SSE store with HMR support
const sseStore = create<SSEState & SSEActions>()(
  devtools(
    (set, get) => ({
      // Initial state - connection management only
      eventSource: null,
      connectionStatus: 'disconnected',
      lastConnectedAt: null,
      subscriptions: new Map(),
      lastError: undefined,
      reconnectAttempts: 0,
      disconnectTimeout: null,

      // Subscribe to filtered events
      subscribe: (filter, callback) => {
        const subscriptionId = generateSubscriptionId();
        const subscription: EventSubscription = {
          id: subscriptionId,
          filter,
          callback,
          createdAt: new Date(),
        };

        // Cancel any pending disconnect since we have a new subscription
        const state = get();
        if (state.disconnectTimeout) {
          clearTimeout(state.disconnectTimeout);
          set({ disconnectTimeout: null });
        }

        const subscriptions = new Map(get().subscriptions);
        subscriptions.set(subscriptionId, subscription);

        set({ subscriptions });

        // Auto-connect if this is the first subscription
        if (subscriptions.size === 1 && get().connectionStatus === 'disconnected') {
          get().connect();
        }

        return subscriptionId;
      },

      // Unsubscribe from events
      unsubscribe: (subscriptionId) => {
        const subscriptions = new Map(get().subscriptions);
        subscriptions.delete(subscriptionId);

        set({ subscriptions });

        // Auto-disconnect with debouncing for React Strict Mode
        if (subscriptions.size === 0 && get().connectionStatus !== 'disconnected') {
          // Clear any existing timeout
          const existingTimeout = get().disconnectTimeout;
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          // Schedule disconnect after delay
          const timeoutId = setTimeout(() => {
            const currentState = get();
            if (
              currentState.subscriptions.size === 0 &&
              currentState.connectionStatus !== 'disconnected'
            ) {
              get().disconnect();
            } else {
            }
            set({ disconnectTimeout: null });
          }, 100); // 100ms buffer for React Strict Mode

          set({ disconnectTimeout: timeoutId });
        }
      },

      // Connect to SSE endpoint
      connect: () => {
        const state = get();

        if (state.eventSource || state.connectionStatus === 'connecting') {
          return;
        }

        set({ connectionStatus: 'connecting', reconnectAttempts: 0 });

        const eventSource = new EventSource('/api/events/stream');

        eventSource.onopen = () => {
          set({
            connectionStatus: 'connected',
            lastConnectedAt: new Date(),
            reconnectAttempts: 0,
            lastError: undefined,
          });
        };

        eventSource.onerror = (error) => {
          console.error(`[SSE-STORE] EventSource error:`, error);
          set((state) => ({
            connectionStatus: 'error',
            lastError: new Error('EventSource connection error'),
            reconnectAttempts: state.reconnectAttempts + 1,
          }));

          // Auto-reconnect logic could be added here
        };

        eventSource.onmessage = (event) => {
          try {
            const laceEvent = parseTyped<LaceEvent>(event.data as string);

            // Route to subscribers directly - no caching
            const { subscriptions } = get();
            subscriptions.forEach((subscription) => {
              try {
                if (eventMatchesFilter(laceEvent, subscription.filter)) {
                  subscription.callback(laceEvent);
                }
              } catch (error) {
                console.error(`[SSE-STORE] Error in subscription ${subscription.id}:`, error);
              }
            });
          } catch (error) {
            console.error(`[SSE-STORE] Failed to parse event:`, error);
          }
        };

        set({ eventSource });
      },

      // Disconnect from SSE
      disconnect: () => {
        const state = get();

        // Clear any pending disconnect timeout
        if (state.disconnectTimeout) {
          clearTimeout(state.disconnectTimeout);
        }

        if (state.eventSource) {
          state.eventSource.close();
          set({
            eventSource: null,
            connectionStatus: 'disconnected',
            lastConnectedAt: null,
            disconnectTimeout: null,
          });
        }
      },

      // Manually reconnect
      reconnect: () => {
        get().disconnect();
        setTimeout(() => get().connect(), 100);
      },

      // Get connection statistics - no event caching
      getConnectionStats: () => {
        const state = get();
        return {
          isConnected: state.connectionStatus === 'connected',
          subscriptionCount: state.subscriptions.size,
          connectionUrl: state.eventSource?.url || null,
          connectedAt: state.lastConnectedAt,
        };
      },
    }),
    {
      name: 'sse-store', // For DevTools
    }
  )
);

// HMR support to prevent store reset during development
if (import.meta.hot && import.meta.hot.data) {
  const hotData = import.meta.hot.data as Record<string, unknown>;
  const savedState = hotData.sseStore as (SSEState & SSEActions) | undefined;
  if (savedState) {
    // Restore state but not the EventSource (needs to be recreated)
    const { eventSource: _, ...stateToRestore } = savedState;
    sseStore.setState({
      ...stateToRestore,
      eventSource: null,
      connectionStatus: 'disconnected',
    } as Partial<SSEState & SSEActions>);
  }

  // Save state before module reload
  sseStore.subscribe((state) => {
    if (import.meta.hot) {
      // Use type assertion for HMR data storage
      const hotData = import.meta.hot.data as Record<string, unknown>;
      hotData.sseStore = state;
    }
  });

  // Accept HMR updates
  import.meta.hot.accept();
}

// Export the store
export const useSSEStore = sseStore;

// Export types for external usage
export type { EventFilter, EventSubscription };
