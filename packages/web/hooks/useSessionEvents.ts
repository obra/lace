// ABOUTME: Event stream hook for session events and tool approvals
// ABOUTME: Real-time updates using unified event stream

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { SessionEvent, ThreadId, ToolApprovalRequestData, PendingApproval } from '@/types/api';
import { parseSessionEvents } from '@/lib/validation/session-event-schemas';

interface UseSessionEventsReturn {
  allEvents: SessionEvent[];
  filteredEvents: SessionEvent[];
  pendingApprovals: PendingApproval[];
  loadingHistory: boolean;
  connected: boolean;
  clearApprovalRequest: () => void;
  // Event handlers for the parent to wire to useEventStream
  addSessionEvent: (event: SessionEvent) => void;
  handleApprovalRequest: (approval: PendingApproval) => void;
  handleApprovalResponse: (toolCallId: string) => void;
}

export function useSessionEvents(
  sessionId: ThreadId | null,
  selectedAgent: ThreadId | null,
  connected = false // Connection state passed from parent
): UseSessionEventsReturn {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Add session event to timeline
  const addSessionEvent = useCallback((sessionEvent: SessionEvent) => {
    setEvents((prev) => {
      // Avoid duplicates by checking event content
      const exists = prev.some(
        (e) =>
          e.type === sessionEvent.type &&
          e.timestamp === sessionEvent.timestamp &&
          e.threadId === sessionEvent.threadId &&
          JSON.stringify(e.data) === JSON.stringify(sessionEvent.data)
      );

      if (exists) return prev;

      return [...prev, sessionEvent].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    });
  }, []);

  // Handle approval requests
  const handleApprovalRequest = useCallback((approval: PendingApproval) => {
    setPendingApprovals((prev) => {
      const exists = prev.some((p) => p.toolCallId === approval.toolCallId);
      if (exists) return prev;
      return [...prev, approval];
    });
  }, []);

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
      .then((res) => res.json())
      .then((data) => {
        if (data.events) {
          try {
            // Parse and validate all events with proper date hydration
            const allEvents = parseSessionEvents(data.events);

            // Filter out approval events (they're handled separately)
            const timelineEvents = allEvents.filter(
              (event) =>
                event.type !== 'TOOL_APPROVAL_REQUEST' && event.type !== 'TOOL_APPROVAL_RESPONSE'
            );

            setEvents(timelineEvents);
          } catch (error) {
            console.error('[SESSION_EVENTS] Failed to parse history events:', error);
            setEvents([]); // Fallback to empty array
          }
        }
      })
      .catch((error) => {
        console.error('[SESSION_EVENTS] Failed to load history:', error);
      });
  }, [sessionId]);

  // Check for pending approvals when agent is selected
  useEffect(() => {
    if (!sessionId || !selectedAgent) {
      setPendingApprovals([]);
      return;
    }

    fetch(`/api/threads/${selectedAgent}/approvals/pending`)
      .then((res) => res.json())
      .then((data) => {
        if (data.pendingApprovals?.length > 0) {
          const approvals = data.pendingApprovals.map((approval: any) => ({
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
