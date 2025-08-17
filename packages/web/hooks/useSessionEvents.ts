// ABOUTME: Event stream hook for thread events
// ABOUTME: Real-time updates using unified event stream (tool approvals now handled by ToolApprovalProvider)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { LaceEvent } from '@/types/core';
import type { ThreadId } from '@/types/core';
import { isInternalWorkflowEvent } from '@/types/core';
import { parse } from '@/lib/serialization';

export interface UseSessionEventsReturn {
  allEvents: LaceEvent[];
  filteredEvents: LaceEvent[];
  loadingHistory: boolean;
  connected: boolean;
  // Event handlers for the parent to wire to useEventStream
  addSessionEvent: (event: LaceEvent) => void;
}

export function useSessionEvents(
  sessionId: ThreadId | null,
  selectedAgent: ThreadId | null,
  connected = false // Connection state passed from parent
): UseSessionEventsReturn {
  const [events, setEvents] = useState<LaceEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Use ref to track seen events for O(1) deduplication
  const seenEvents = useRef(new Set<string>());

  // Generate a composite key for event deduplication
  const getEventKey = useCallback((event: LaceEvent): string => {
    return `${event.type}:${event.timestamp}:${event.threadId}:${JSON.stringify(event.data)}`;
  }, []);

  // Add thread event to timeline
  const addSessionEvent = useCallback(
    (threadEvent: LaceEvent) => {
      const eventKey = getEventKey(threadEvent);

      // O(1) duplicate check
      if (seenEvents.current.has(eventKey)) {
        return;
      }

      seenEvents.current.add(eventKey);

      setEvents((prev) => {
        // Insert in sorted position to avoid full sort
        const timestamp = new Date(threadEvent.timestamp || new Date()).getTime();
        let insertIndex = prev.length;

        // Find insertion point (reverse search since newer events are more common)
        for (let i = prev.length - 1; i >= 0; i--) {
          if (new Date(prev[i]!.timestamp || new Date()).getTime() <= timestamp) {
            insertIndex = i + 1;
            break;
          }
          if (i === 0) {
            insertIndex = 0;
          }
        }

        const newEvents = [...prev];
        newEvents.splice(insertIndex, 0, threadEvent);
        return newEvents;
      });
    },
    [getEventKey]
  );

  // Connection state is now managed by parent

  // Load historical events when session changes
  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);

    // Load session history
    fetch(`/api/sessions/${sessionId}/history`)
      .then(async (res) => {
        const text = await res.text();
        return parse(text) as LaceEvent[];
      })
      .then((data) => {
        if (data) {
          // Events are already properly typed LaceEvents from superjson
          // Filter out internal workflow events (they're handled separately)
          const timelineEvents = data.filter((event) => !isInternalWorkflowEvent(event.type));

          setEvents(timelineEvents);
        }
        setLoadingHistory(false);
      })
      .catch((error) => {
        console.error('[SESSION_EVENTS] Failed to load history:', error);
        setLoadingHistory(false);
      });
  }, [sessionId]);

  // Filter events by selected agent
  const filteredEvents = useMemo(() => {
    if (!selectedAgent) return [];

    return events.filter((event) => {
      // Always show user messages and system messages
      if (event.type === 'USER_MESSAGE' || event.type === 'LOCAL_SYSTEM_MESSAGE') {
        return true;
      }

      // Show events from the selected agent's thread
      return event.threadId === selectedAgent;
    });
  }, [events, selectedAgent]);

  return {
    allEvents: events,
    filteredEvents,
    loadingHistory,
    connected,
    // Export event handlers for parent to use
    addSessionEvent,
  };
}
