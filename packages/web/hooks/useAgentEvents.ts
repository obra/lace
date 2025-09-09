// ABOUTME: Event stream hook for agent-specific events
// ABOUTME: Loads historical events for a specific agent and handles real-time updates

import { useState, useEffect, useCallback, useRef } from 'react';
import type { LaceEvent } from '@/types/core';
import type { ThreadId } from '@/types/core';
import { isInternalWorkflowEvent } from '@/types/core';
import { api } from '@/lib/api-client';

export interface UseAgentEventsReturn {
  events: LaceEvent[];
  loadingHistory: boolean;
  connected: boolean;
  // Event handlers for the parent to wire to useEventStream
  addAgentEvent: (event: LaceEvent) => void;
}

export function useAgentEvents(
  agentId: ThreadId | null,
  connected = false // Connection state passed from parent
): UseAgentEventsReturn {
  const [events, setEvents] = useState<LaceEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Use ref to track seen events for O(1) deduplication
  const seenEvents = useRef(new Set<string>());

  // Track if component is still mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

    // Add small delay to prevent rapid cancellation during page reload
    const timeoutId = setTimeout(() => {
      // Check if still mounted before making request
      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      void api
        .get<LaceEvent[]>(`/api/agents/${agentId}/history`, { signal: controller.signal })
        .then((data) => {
          // Check if still mounted before updating state
          if (!isMountedRef.current) {
            return;
          }

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

          if (isMountedRef.current) {
            setLoadingHistory(false);
          }
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== 'AbortError' && isMountedRef.current) {
            console.error('[AGENT_EVENTS] Failed to load history:', error);
            setLoadingHistory(false);
          }
        });
    }, 50); // 50ms delay to prevent rapid cancellation

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [agentId, getEventKey]);

  return {
    events,
    loadingHistory,
    connected,
    // Export event handlers for parent to use
    addAgentEvent,
  };
}
