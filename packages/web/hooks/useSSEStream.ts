// ABOUTME: React hook for managing SSE connections and event processing
// ABOUTME: Handles connection state, reconnection, and event parsing

import { useEffect, useRef, useState, useCallback } from 'react';
import { SessionEvent } from '@/types/api';
import { type ThreadId } from '@/lib/server/core-types';

interface SSEStreamState {
  connected: boolean;
  events: SessionEvent[];
  error: string | null;
}

export function useSSEStream(sessionId: ThreadId | null) {
  const [state, setState] = useState<SSEStreamState>({
    connected: false,
    events: [],
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!sessionId || eventSourceRef.current) return;

    try {
      const eventSource = new EventSource(`/api/sessions/${sessionId}/events/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setState((prev) => ({ ...prev, connected: true, error: null }));
      };

      eventSource.onerror = () => {
        setState((prev) => ({ ...prev, connected: false, error: 'Connection lost' }));

        // Attempt reconnection after delay
        eventSource.close();
        eventSourceRef.current = null;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      // Handle connection event
      eventSource.addEventListener('connection', () => {
        // Connection established, no action needed
      });

      // Handle all event types
      const eventTypes = [
        'USER_MESSAGE',
        'AGENT_MESSAGE',
        'TOOL_CALL',
        'TOOL_RESULT',
        'SYSTEM_MESSAGE',
        'LOCAL_SYSTEM_MESSAGE',
        'TOOL_APPROVAL_REQUEST',
        'AGENT_TOKEN',
      ];

      eventTypes.forEach((eventType) => {
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          const eventData = JSON.parse(event.data as string) as SessionEvent;
          setState((prev) => {
            // Keep only the last 1000 events to prevent memory/quota issues
            const newEvents = [...prev.events, eventData];
            if (newEvents.length > 1000) {
              newEvents.splice(0, newEvents.length - 1000);
            }
            return {
              ...prev,
              events: newEvents,
            };
          });
        });
      });
    } catch (_error) {
      setState((prev) => ({
        ...prev,
        connected: false,
        error: 'Failed to connect',
      }));
    }
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setState((prev) => ({ ...prev, connected: false }));
  }, []);

  const clearEvents = useCallback(() => {
    setState((prev) => ({ ...prev, events: [] }));
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  return {
    connected: state.connected,
    events: state.events,
    error: state.error,
    clearEvents,
  };
}
