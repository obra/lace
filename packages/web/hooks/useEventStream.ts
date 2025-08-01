// ABOUTME: React hook for event streams with client-side filtering
// ABOUTME: Real-time events across projects and sessions

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  StreamEvent,
  StreamSubscription,
  StreamConnection,
  EventFilter,
  createEventFilter,
} from '@/types/stream-events';

interface UseEventStreamOptions {
  subscription: StreamSubscription;
  onEvent?: (event: StreamEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

interface UseEventStreamResult {
  connection: StreamConnection;
  lastEvent?: StreamEvent;
  sendCount: number;
  close: () => void;
  reconnect: () => void;
}

export function useEventStream({
  subscription,
  onEvent,
  onConnect,
  onDisconnect,
  onError,
  autoReconnect = true,
  reconnectInterval = 1000,
}: UseEventStreamOptions): UseEventStreamResult {
  const [connection, setConnection] = useState<StreamConnection>({
    connected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
  });

  const [lastEvent, setLastEvent] = useState<StreamEvent>();
  const [sendCount, setSendCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const filterRef = useRef<EventFilter>();

  // Store callbacks in refs to avoid recreating connect on every callback change
  const callbackRefs = useRef({
    onEvent,
    onConnect,
    onDisconnect,
    onError,
  });

  // Update callback refs when callbacks change
  useEffect(() => {
    callbackRefs.current = {
      onEvent,
      onConnect,
      onDisconnect,
      onError,
    };
  }, [onEvent, onConnect, onDisconnect, onError]);

  // Create event filter from subscription
  useEffect(() => {
    // Import the function dynamically to avoid circular dependencies
    import('@/types/stream-events').then(({ createEventFilter }) => {
      filterRef.current = createEventFilter(subscription);
    });
  }, [subscription]);

  // Build query string from subscription
  const buildQueryString = useCallback((sub: StreamSubscription): string => {
    const params = new URLSearchParams();

    if (sub.projects?.length) params.set('projects', sub.projects.join(','));
    if (sub.sessions?.length) params.set('sessions', sub.sessions.join(','));
    if (sub.threads?.length) params.set('threads', sub.threads.join(','));
    if (sub.global) params.set('global', 'true');
    if (sub.eventTypes?.length) params.set('eventTypes', sub.eventTypes.join(','));

    return params.toString();
  }, []);

  // Connect to stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const queryString = buildQueryString(subscription);
    const url = `/api/events/stream${queryString ? `?${queryString}` : ''}`;

    console.log('[EVENT_STREAM_HOOK] Connecting to:', url);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[EVENT_STREAM_HOOK] Connected');
      setConnection((prev) => ({
        ...prev,
        connected: true,
        reconnectAttempts: 0,
      }));
      callbackRefs.current.onConnect?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const streamEvent = JSON.parse(event.data) as StreamEvent;

        // Apply client-side filtering
        if (filterRef.current && !filterRef.current.shouldIncludeEvent(streamEvent)) {
          return;
        }

        console.log('[EVENT_STREAM_HOOK] Received event:', streamEvent);

        setLastEvent(streamEvent);
        setSendCount((prev) => prev + 1);
        setConnection((prev) => ({
          ...prev,
          lastEventId: streamEvent.id,
        }));

        callbackRefs.current.onEvent?.(streamEvent);
      } catch (error) {
        console.error('[EVENT_STREAM_HOOK] Failed to parse event:', error);
        callbackRefs.current.onError?.(error as Error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[EVENT_STREAM_HOOK] Connection error:', error);

      setConnection((prev) => {
        const newState = {
          ...prev,
          connected: false,
          reconnectAttempts: prev.reconnectAttempts + 1,
        };

        callbackRefs.current.onDisconnect?.();
        callbackRefs.current.onError?.(new Error('SSE connection failed'));

        // Auto-reconnect logic using current state
        if (autoReconnect && newState.reconnectAttempts < newState.maxReconnectAttempts) {
          console.log(
            `[EVENT_STREAM_HOOK] Reconnecting in ${reconnectInterval}ms (attempt ${newState.reconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(
            () => {
              connect();
            },
            reconnectInterval * Math.pow(2, newState.reconnectAttempts - 1)
          ); // Exponential backoff
        }

        return newState;
      });
    };
  }, [subscription, buildQueryString, autoReconnect, reconnectInterval]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    setConnection((prev) => ({ ...prev, reconnectAttempts: 0 }));
    connect();
  }, [connect]);

  // Close connection
  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnection((prev) => ({ ...prev, connected: false }));
  }, []);

  // Connect on mount, reconnect when subscription changes
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnection((prev) => ({ ...prev, connected: false }));
    };
  }, [connect]);

  return {
    connection,
    lastEvent,
    sendCount,
    close,
    reconnect,
  };
}

// Convenience hooks for specific event types
export function useSessionStream(sessionId: string, options?: Partial<UseEventStreamOptions>) {
  return useEventStream({
    subscription: { sessions: [sessionId] },
    ...options,
  });
}

export function useProjectStream(projectId: string, options?: Partial<UseEventStreamOptions>) {
  return useEventStream({
    subscription: { projects: [projectId] },
    ...options,
  });
}

export function useGlobalStream(options?: Partial<UseEventStreamOptions>) {
  return useEventStream({
    subscription: { global: true },
    ...options,
  });
}

export function useMultiSessionStream(
  sessionIds: string[],
  options?: Partial<UseEventStreamOptions>
) {
  return useEventStream({
    subscription: { sessions: sessionIds },
    ...options,
  });
}
