// ABOUTME: Event stream hook for thread events
// ABOUTME: Real-time updates using unified event stream (tool approvals now handled by ToolApprovalProvider)

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { LaceEvent } from '@/types/core';
import type { ThreadId } from '@/types/core';
import { isInternalWorkflowEvent } from '@/types/core';
import { api } from '@/lib/api-client';

// Runtime type guards for safe parsing
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return !!val && typeof val === 'object' && !Array.isArray(val);
}

function isLaceEvent(val: unknown): val is LaceEvent {
  if (!isPlainObject(val)) return false;
  const type = val.type;
  const threadId = val.threadId;
  const timestamp = val.timestamp;
  return (
    typeof type === 'string' &&
    typeof threadId === 'string' &&
    (typeof timestamp === 'string' || typeof timestamp === 'number')
  );
}

function isLaceEventArray(data: unknown): data is LaceEvent[] {
  return Array.isArray(data) && data.every(isLaceEvent);
}

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
        const timestamp = new Date(threadEvent.timestamp ?? new Date()).getTime();
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
        newEvents.splice(insertIndex, 0, threadEvent);
        return newEvents;
      });
    },
    [getEventKey]
  );

  // Connection state is now managed by parent

  // Load historical events when session or selected agent changes
  useEffect(() => {
    if (!sessionId || !selectedAgent) {
      seenEvents.current.clear();
      setEvents([]);
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    const controller = new AbortController();

    void api
      .get<unknown>(`/api/threads/${selectedAgent}/history`, { signal: controller.signal })
      .then((data) => {
        if (isLaceEventArray(data)) {
          // Events are already properly typed LaceEvents from superjson
          // Filter out internal workflow events (they're handled separately)
          const timelineEvents = data.filter((event) => !isInternalWorkflowEvent(event.type));

          // Merge history with existing streamed events using dedup guard
          setEvents((prev) => {
            const newUniqueEvents: LaceEvent[] = [];
            for (const event of timelineEvents) {
              const eventKey = getEventKey(event);
              if (!seenEvents.current.has(eventKey)) {
                newUniqueEvents.push(event);
                seenEvents.current.add(eventKey);
              }
            }

            // Merge and sort by timestamp for chronological order
            const mergedEvents = [...prev, ...newUniqueEvents];
            return mergedEvents.sort((a, b) => {
              const aTime = new Date(a.timestamp ?? new Date()).getTime();
              const bTime = new Date(b.timestamp ?? new Date()).getTime();
              return aTime - bTime;
            });
          });
        } else {
          console.warn('[SESSION_EVENTS] Received non-array data:', data);
          seenEvents.current.clear();
          setEvents([]);
        }
        setLoadingHistory(false);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') {
          console.error('[SESSION_EVENTS] Failed to load history:', error);
          setLoadingHistory(false);
        }
      });

    return () => controller.abort();
  }, [sessionId, selectedAgent, getEventKey]);

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
