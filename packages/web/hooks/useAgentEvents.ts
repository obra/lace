// ABOUTME: Event stream hook for agent-specific events
// ABOUTME: Loads historical events for a specific agent and handles real-time updates

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppEvent } from '@lace/web/types/app-events';
import type { LaceEvent } from '@lace/web/types/core';
import { isWebEvent } from '@lace/web/types/app-events';
import type { ThreadId } from '@lace/web/types/core';
import { api } from '@lace/web/lib/api-client';

interface UseAgentEventsReturn {
  events: Array<AppEvent | LaceEvent>;
  loadingHistory: boolean;
  connected: boolean;
  // Event handlers for the parent to wire to useEventStream
  addAgentEvent: (event: AppEvent | LaceEvent) => void;
  updateEventVisibility: (eventId: string, visibleToModel: boolean) => void;
}

export function useAgentEvents(
  agentId: ThreadId | null,
  connected = false // Connection state passed from parent
): UseAgentEventsReturn {
  const [events, setEvents] = useState<Array<AppEvent | LaceEvent>>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Use ref to track seen events for O(1) deduplication
  const seenEvents = useRef(new Set<string>());

  // Generate a composite key for event deduplication
  const getEventKey = useCallback((event: AppEvent | LaceEvent): string => {
    // Handle AppEvent types
    if ('update' in event && event.update !== undefined) {
      // ProtocolEvent
      return `protocol:${(event.update as { type?: string }).type ?? 'unknown'}:${event.timestamp.getTime()}:${event.id}`;
    }

    if ('request' in event && event.request !== undefined) {
      // PermissionRequestEvent
      return `protocol:permission_request:${event.timestamp.getTime()}:${event.id}`;
    }

    if ('type' in event && isWebEvent(event as AppEvent)) {
      // WebEvent
      const webEvent = event as AppEvent & { timestamp: Date };
      return `web:${(event as AppEvent & { type: string }).type}:${webEvent.timestamp.getTime()}:${event.id}`;
    }

    // Handle LaceEvent types
    if ('context' in event && 'type' in event) {
      // LaceEvent
      const laceEvent = event as LaceEvent;
      let timestamp: number;
      if (laceEvent.timestamp instanceof Date) {
        timestamp = laceEvent.timestamp.getTime();
      } else if (
        typeof laceEvent.timestamp === 'string' ||
        typeof laceEvent.timestamp === 'number'
      ) {
        timestamp = new Date(laceEvent.timestamp).getTime();
      } else {
        timestamp = Date.now();
      }
      return `lace:${laceEvent.type}:${timestamp}:${laceEvent.id}`;
    }

    return `unknown:${(event as unknown as { id?: string }).id ?? 'no-id'}`;
  }, []);

  // Add agent event to timeline
  const addAgentEvent = useCallback(
    (agentEvent: AppEvent | LaceEvent) => {
      const eventKey = getEventKey(agentEvent);

      // O(1) duplicate check
      if (seenEvents.current.has(eventKey)) {
        return;
      }

      seenEvents.current.add(eventKey);

      setEvents((prev) => {
        // Insert in sorted position to avoid full sort
        let timestamp: number;
        if (agentEvent.timestamp instanceof Date) {
          timestamp = agentEvent.timestamp.getTime();
        } else if (
          typeof agentEvent.timestamp === 'string' ||
          typeof agentEvent.timestamp === 'number'
        ) {
          timestamp = new Date(agentEvent.timestamp).getTime();
        } else {
          timestamp = Date.now();
        }

        let insertIndex = prev.length;

        // Find insertion point (reverse search since newer events are more common)
        for (let i = prev.length - 1; i >= 0; i--) {
          const prevEvent = prev[i];
          if (!prevEvent) {
            continue;
          }

          let prevTimestamp: number;
          if (prevEvent.timestamp instanceof Date) {
            prevTimestamp = prevEvent.timestamp.getTime();
          } else if (
            typeof prevEvent.timestamp === 'string' ||
            typeof prevEvent.timestamp === 'number'
          ) {
            prevTimestamp = new Date(prevEvent.timestamp).getTime();
          } else {
            prevTimestamp = Date.now();
          }

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
