// ABOUTME: Event stream hook for agent-specific events
// ABOUTME: Loads historical events for a specific agent and handles real-time updates

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LaceEvent } from '@lace/web/types/core';
import type { ThreadId } from '@lace/web/types/core';
import { isInternalWorkflowEvent } from '@lace/web/types/core';
import { api } from '@lace/web/lib/api-client';

interface UseAgentEventsReturn {
  events: LaceEvent[];
  loadingHistory: boolean;
  connected: boolean;
  // Event handlers for the parent to wire to useEventStream
  addAgentEvent: (event: LaceEvent) => void;
  updateEventVisibility: (eventId: string, visibleToModel: boolean) => void;
}

export function useAgentEvents(
  agentId: ThreadId | null,
  connected = false // Connection state passed from parent
): UseAgentEventsReturn {
  const [events, setEvents] = useState<LaceEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Use ref to track seen events for O(1) deduplication
  const seenEvents = useRef(new Set<string>());

  // Generate a composite key for event deduplication
  const getEventKey = useCallback((event: LaceEvent): string => {
    return `${event.type}:${event.timestamp}:${event.context?.threadId}:${JSON.stringify(event.data)}`;
  }, []);

  // Add agent event to timeline
  const addAgentEvent = useCallback(
    (agentEvent: LaceEvent) => {
      const eventKey = getEventKey(agentEvent);

      // O(1) duplicate check
      if (seenEvents.current.has(eventKey)) {
        return;
      }

      seenEvents.current.add(eventKey);

      setEvents((prev) => {
        // Insert in sorted position to avoid full sort
        const timestamp = new Date(agentEvent.timestamp ?? new Date()).getTime();
        let insertIndex = prev.length;

        // Find insertion point (reverse search since newer events are more common)
        for (let i = prev.length - 1; i >= 0; i--) {
          if (new Date(prev[i]!.timestamp ?? new Date()).getTime() <= timestamp) {
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
        const data = await api.get<LaceEvent[]>(`/api/agents/${agentId}/history`, {
          signal: controller.signal,
        });

        // If request was aborted, don't update state
        if (controller.signal.aborted) {
          return;
        }

        // Events are already properly typed LaceEvents from superjson
        // Filter out internal workflow events (they're handled separately)
        const timelineEvents = data.filter((event) => !isInternalWorkflowEvent(event.type));

        // Clear seen events and rebuild from scratch to ensure consistency
        seenEvents.current.clear();

        // Add all historical events to seen set
        for (const event of timelineEvents) {
          const eventKey = getEventKey(event);
          seenEvents.current.add(eventKey);
        }

        // Sort events by timestamp for chronological order
        const sortedEvents = timelineEvents.sort((a, b) => {
          const aTime = new Date(a.timestamp ?? new Date()).getTime();
          const bTime = new Date(b.timestamp ?? new Date()).getTime();
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
