// ABOUTME: Event stream hook for session events and tool approvals
// ABOUTME: Real-time updates with client-side filtering

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEventStream } from './useEventStream';
import type { SessionEvent, ThreadId, ToolApprovalRequestData } from '@/types/api';
import type { StreamEvent } from '@/types/stream-events';
import {
  parseSessionEvent,
  parseSessionEvents,
  StreamEventTimestampSchema,
} from '@/lib/validation/session-event-schemas';

interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
}

interface UseSessionEventsReturn {
  allEvents: SessionEvent[];
  filteredEvents: SessionEvent[];
  pendingApprovals: PendingApproval[];
  loadingHistory: boolean;
  connected: boolean;
  clearApprovalRequest: () => void;
}

export function useSessionEvents(
  sessionId: ThreadId | null,
  selectedAgent: ThreadId | null
): UseSessionEventsReturn {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Set up unified stream subscription
  const subscription = useMemo(
    () => ({
      sessions: sessionId ? [sessionId] : [],
      threads: selectedAgent ? [selectedAgent] : [],
      eventTypes: [
        'USER_MESSAGE',
        'AGENT_MESSAGE',
        'TOOL_CALL',
        'TOOL_RESULT',
        'TOOL_APPROVAL_REQUEST',
        'TOOL_APPROVAL_RESPONSE',
        'LOCAL_SYSTEM_MESSAGE',
        'AGENT_TOKEN',
        'AGENT_STREAMING',
        'COMPACTION',
        'SYSTEM_PROMPT',
        'USER_SYSTEM_PROMPT',
      ],
    }),
    [sessionId, selectedAgent]
  );

  // Handle events from stream
  const handleStreamEvent = useCallback((streamEvent: StreamEvent) => {
    try {
      // Parse and validate SessionEvent with proper date hydration
      const sessionEvent = parseSessionEvent(streamEvent.data);

      // Also ensure the StreamEvent timestamp is a Date
      const streamTimestamp = StreamEventTimestampSchema.parse(streamEvent.timestamp);

      // Handle tool approval requests
      if (sessionEvent.type === 'TOOL_APPROVAL_REQUEST') {
        const approvalData = sessionEvent.data as ToolApprovalRequestData & { toolCallId?: string };

        const pendingApproval: PendingApproval = {
          toolCallId: approvalData.toolCallId || approvalData.requestId,
          toolCall: {
            name: approvalData.toolName,
            arguments: approvalData.input,
          },
          requestedAt: streamTimestamp,
          requestData: approvalData,
        };

        setPendingApprovals((prev) => {
          const exists = prev.some((p) => p.toolCallId === pendingApproval.toolCallId);
          if (exists) return prev;
          return [...prev, pendingApproval];
        });

        // Don't add approval requests to timeline
        return;
      }

      // Handle tool approval responses
      if (sessionEvent.type === 'TOOL_APPROVAL_RESPONSE') {
        const responseData = sessionEvent.data as { toolCallId: string };
        setPendingApprovals((prev) => prev.filter((p) => p.toolCallId !== responseData.toolCallId));

        // Don't add approval responses to timeline
        return;
      }

      // Add to events list
      setEvents((prev) => {
        // Avoid duplicates by checking event content
        const exists = prev.some(
          (e) =>
            e.type === sessionEvent.type &&
            e.timestamp.getTime() === sessionEvent.timestamp.getTime() &&
            e.threadId === sessionEvent.threadId &&
            JSON.stringify(e.data) === JSON.stringify(sessionEvent.data)
        );

        if (exists) return prev;

        return [...prev, sessionEvent].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );
      });
    } catch (error) {
      console.error('[SESSION_EVENTS] Failed to parse stream event:', error, streamEvent);
      // Don't crash the app - just skip invalid events
    }
  }, []);

  // Use event stream
  const { connection } = useEventStream({
    subscription,
    onEvent: handleStreamEvent,
    onConnect: () => {
      setLoadingHistory(false);
    },
    onError: (error) => {
      console.error('[SESSION_EVENTS] Stream error:', error);
    },
  });

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
            requestedAt: new Date(approval.requestedAt),
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
    connected: connection.connected,
    clearApprovalRequest,
  };
}
