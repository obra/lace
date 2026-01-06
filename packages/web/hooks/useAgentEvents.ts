// ABOUTME: Event stream hook for agent-specific events
// ABOUTME: Loads historical events for a specific agent and handles real-time updates

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppEvent } from '@lace/web/types/app-events';
import { isWebEvent, isProtocolEvent, isPermissionRequestEvent } from '@lace/web/types/app-events';
import type { ThreadId } from '@lace/web/types/core';
import { api } from '@lace/web/lib/api-client';

interface UseAgentEventsReturn {
  events: AppEvent[];
  loadingHistory: boolean;
  connected: boolean;
  // Event handlers for the parent to wire to useEventStream
  addAgentEvent: (event: AppEvent) => void;
  updateEventVisibility: (eventId: string, visibleToModel: boolean) => void;
}

export function useAgentEvents(
  agentId: ThreadId | null,
  connected = false // Connection state passed from parent
): UseAgentEventsReturn {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Use ref to track seen events for O(1) deduplication
  const seenEvents = useRef(new Set<string>());

  // Generate a composite key for event deduplication
  const getEventKey = useCallback((event: AppEvent): string => {
    if (isProtocolEvent(event)) {
      return `protocol:${event.update.type}:${event.timestamp.getTime()}:${event.id}`;
    }

    if (isPermissionRequestEvent(event)) {
      return `protocol:permission_request:${event.timestamp.getTime()}:${event.id}`;
    }

    if (isWebEvent(event)) {
      return `web:${event.type}:${event.timestamp.getTime()}:${event.id}`;
    }

    // TypeScript exhaustiveness check - all AppEvent types are covered above
    // This line is unreachable but satisfies the return type requirement
    const _exhaustiveCheck: never = event;
    return `unknown:${(_exhaustiveCheck as AppEvent).id}`;
  }, []);

  // Add agent event to timeline
  const addAgentEvent = useCallback(
    (agentEvent: AppEvent) => {
      const eventKey = getEventKey(agentEvent);

      // O(1) duplicate check
      if (seenEvents.current.has(eventKey)) {
        return;
      }

      seenEvents.current.add(eventKey);

      setEvents((prev) => {
        // Insert in sorted position to avoid full sort
        // AppEvent.timestamp is always Date
        const timestamp = agentEvent.timestamp.getTime();

        let insertIndex = prev.length;

        // Find insertion point (reverse search since newer events are more common)
        for (let i = prev.length - 1; i >= 0; i--) {
          const prevEvent = prev[i];
          if (!prevEvent) {
            continue;
          }

          // AppEvent.timestamp is always Date
          const prevTimestamp = prevEvent.timestamp.getTime();

          if (prevTimestamp <= timestamp) {
            insertIndex = i + 1;
            break;
          }
          if (i === 0) {
            insertIndex = 0;
          }
        }

        const newEvents = [...prev];
        newEvents.splice(insertIndex, 0, agentEvent);
        return newEvents;
      });
    },
    [getEventKey]
  );

  // Update event visibility when EVENT_UPDATED is received
  const updateEventVisibility = useCallback((eventId: string, visibleToModel: boolean) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, visibleToModel } : e)));
  }, []);

  // Load historical events when agent changes
  useEffect(() => {
    if (!agentId) {
      seenEvents.current.clear();
      setEvents([]);
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    const controller = new AbortController();

    // Immediately start loading without delay to reduce race conditions
    const loadHistory = async () => {
      try {
        const data = await api.get<AppEvent[]>(`/api/agents/${agentId}/history`, {
          signal: controller.signal,
        });

        // If request was aborted, don't update state
        if (controller.signal.aborted) {
          return;
        }

        // Events are already properly typed AppEvents from superjson
        // Filter out internal workflow events (TOOL_APPROVAL_RESPONSE web events)
        const timelineEvents = data.filter((event) => {
          // Exclude web events that are internal workflow events
          if (isWebEvent(event) && event.type === 'TOOL_APPROVAL_RESPONSE') {
            return false;
          }
          return true;
        });

        // Clear seen events and rebuild from scratch to ensure consistency
        seenEvents.current.clear();

        // Add all historical events to seen set
        for (const event of timelineEvents) {
          const eventKey = getEventKey(event);
          seenEvents.current.add(eventKey);
        }

        // Sort events by timestamp for chronological order
        const sortedEvents = timelineEvents.sort((a, b) => {
          const aTime = a.timestamp.getTime();
          const bTime = b.timestamp.getTime();
          return aTime - bTime;
        });

        setEvents(sortedEvents);
        setLoadingHistory(false);
      } catch (error: unknown) {
        // Only handle non-abort errors
        if ((error as { name?: string }).name !== 'AbortError') {
          console.error('[AGENT_EVENTS] Failed to load history:', error);
          setLoadingHistory(false);
        }
        // Note: AbortError is expected when component unmounts, so we don't log it
      }
    };

    void loadHistory();

    return () => {
      controller.abort();
    };
  }, [agentId, getEventKey]);

  return {
    events,
    loadingHistory,
    connected,
    // Export event handlers for parent to use
    addAgentEvent,
    updateEventVisibility,
  };
}
