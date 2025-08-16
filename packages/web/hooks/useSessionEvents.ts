// ABOUTME: Event stream hook for thread events and tool approvals
// ABOUTME: Real-time updates using unified event stream

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { LaceEvent } from '@/types/core';
import type { PendingApproval } from '@/types/api';
import type { ThreadId } from '@/types/core';
import { isInternalWorkflowEvent } from '@/types/core';
import { parse } from '@/lib/serialization';

export interface UseSessionEventsReturn {
  allEvents: LaceEvent[];
  filteredEvents: LaceEvent[];
  pendingApprovals: PendingApproval[];
  loadingHistory: boolean;
  connected: boolean;
  clearApprovalRequest: () => void;
  // Event handlers for the parent to wire to useEventStream
  addSessionEvent: (event: LaceEvent) => void;
  handleApprovalRequest: (approval: PendingApproval) => void;
  handleApprovalResponse: (toolCallId: string) => void;
}

export function useSessionEvents(
  sessionId: ThreadId | null,
  selectedAgent: ThreadId | null,
  connected = false // Connection state passed from parent
): UseSessionEventsReturn {
  const [events, setEvents] = useState<LaceEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
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

  // Handle approval requests
  const handleApprovalRequest = useCallback(
    (approval: PendingApproval) => {
      // When we get a TOOL_APPROVAL_REQUEST, we need to trigger a refresh
      // The pending approvals will be fetched from the API endpoint
      // which has access to the tool metadata to properly enrich the data
      setPendingApprovals((prev) => {
        // Just mark that we need to refresh - the useEffect below will fetch the data
        return prev;
      });

      // Trigger a fetch of pending approvals if we have a selected agent
      if (selectedAgent) {
        void fetch(`/api/threads/${selectedAgent}/approvals/pending`)
          .then(async (res) => {
            const text = await res.text();
            return parse(text) as PendingApproval[];
          })
          .then((data) => {
            setPendingApprovals(data || []);
          })
          .catch((error) => {
            console.error('[SESSION_EVENTS] Failed to fetch pending approvals:', error);
          });
      }
    },
    [selectedAgent]
  );

  // Handle approval responses
  const handleApprovalResponse = useCallback((toolCallId: string) => {
    setPendingApprovals((prev) => prev.filter((p) => p.toolCallId !== toolCallId));
  }, []);

  // Connection state is now managed by parent

  // Load historical events when session changes
  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setPendingApprovals([]);
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

  // Check for pending approvals when agent is selected
  useEffect(() => {
    if (!sessionId || !selectedAgent) {
      setPendingApprovals([]);
      return;
    }

    fetch(`/api/threads/${selectedAgent}/approvals/pending`)
      .then(async (res) => {
        const text = await res.text();
        return parse(text) as PendingApproval[];
      })
      .then((data) => {
        if (data?.length > 0) {
          const approvals = data.map((approval: PendingApproval) => ({
            toolCallId: approval.toolCallId,
            toolCall: approval.toolCall,
            requestedAt: approval.requestedAt, // Keep as string now
            requestData: approval.requestData,
          }));
          setPendingApprovals(approvals);
        } else {
          setPendingApprovals([]);
        }
      })
      .catch((error) => {
        console.error('[SESSION_EVENTS] Failed to check pending approvals:', error);
      });
  }, [sessionId, selectedAgent]);

  // Clear approval request
  const clearApprovalRequest = useCallback(() => {
    setPendingApprovals([]);
  }, []);

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
    pendingApprovals,
    loadingHistory,
    connected,
    clearApprovalRequest,
    // Export event handlers for parent to use
    addSessionEvent,
    handleApprovalRequest,
    handleApprovalResponse,
  };
}
