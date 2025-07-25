// ABOUTME: Custom hook for managing session events and SSE connections
// ABOUTME: Handles event loading, filtering, and real-time updates for agent conversations

import { useState, useEffect, useCallback } from 'react';
import { SessionEvent, ThreadId, ToolApprovalRequestData } from '@/types/api';
import { isApiError } from '@/types/api';
import { getAllEventTypes } from '@/types/events';

interface UseSessionEventsReturn {
  // Event data
  allEvents: SessionEvent[];
  filteredEvents: SessionEvent[];

  // Tool approval
  approvalRequest: ToolApprovalRequestData | null;

  // Loading states
  loadingHistory: boolean;
  connected: boolean;

  // Actions
  clearApprovalRequest: () => void;
}

export function useSessionEvents(
  sessionId: ThreadId | null,
  selectedAgent: ThreadId | null
): UseSessionEventsReturn {
  const [allEvents, setAllEvents] = useState<SessionEvent[]>([]);
  const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequestData | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [connected, setConnected] = useState(false);

  // Filter events for the selected agent
  const filteredEvents = selectedAgent
    ? allEvents.filter((event) => event.threadId === selectedAgent)
    : [];

  // Load conversation history for entire session
  const loadConversationHistory = useCallback(async (sessionId: ThreadId) => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/history`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load conversation history:', data.error);
        return;
      }

      const historyData = data as { events: Array<SessionEvent & { timestamp: string }> };

      // Convert string timestamps to Date objects - keep ALL events
      const eventsWithDateTimestamps: SessionEvent[] = (historyData.events || []).map((event) => ({
        ...event,
        timestamp: new Date(event.timestamp),
      }));

      setAllEvents(eventsWithDateTimestamps);
    } catch (error) {
      console.error('Failed to load conversation history:', error);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Check for pending approvals when agent is selected
  const checkPendingApprovals = useCallback(async (sessionId: ThreadId, agentId: ThreadId) => {
    try {
      const res = await fetch(`/api/threads/${agentId}/approvals/pending`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to check pending approvals:', data.error);
        return;
      }

      const approvalData = data as { pendingApprovals: Array<{ toolCallId: string; toolCall: unknown; requestData: ToolApprovalRequestData }> };
      
      // If there are pending approvals, set the first one to show the modal
      if (approvalData.pendingApprovals && approvalData.pendingApprovals.length > 0) {
        const pendingApproval = approvalData.pendingApprovals[0];
        setApprovalRequest(pendingApproval.requestData);
      }
    } catch (error) {
      console.error('Failed to check pending approvals:', error);
    }
  }, []);

  // Clear approval request
  const clearApprovalRequest = useCallback(() => {
    setApprovalRequest(null);
  }, []);

  // SSE connection effect
  useEffect(() => {
    if (!sessionId) {
      setAllEvents([]);
      setConnected(false);
      return;
    }

    // Load initial history
    void loadConversationHistory(sessionId);

    // Set up SSE connection
    const eventSource = new EventSource(`/api/sessions/${sessionId}/events/stream`);

    // Store event listeners for cleanup
    const eventListeners = new Map<string, (event: MessageEvent) => void>();

    // Listen to all event types
    const eventTypes = getAllEventTypes();

    eventTypes.forEach((eventType) => {
      const listener = (event: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(String(event.data));

          // Type guard for event structure
          if (typeof data === 'object' && data !== null && 'type' in data) {
            const eventData = data as {
              type: string;
              threadId?: ThreadId;
              data: unknown;
              timestamp?: string | Date;
            };

            // Handle approval requests separately (these don't have threadId filtering)
            if (eventData.type === 'TOOL_APPROVAL_REQUEST') {
              setApprovalRequest(eventData.data as ToolApprovalRequestData);
            } else if (eventData.threadId) {
              // Convert timestamp from string to Date if needed
              const timestamp = eventData.timestamp
                ? typeof eventData.timestamp === 'string'
                  ? new Date(eventData.timestamp)
                  : eventData.timestamp
                : new Date();

              // Create the session event preserving original threadId
              const sessionEvent = {
                ...eventData,
                timestamp,
              } as SessionEvent;

              // Add to ALL events - filtering happens at render time
              setAllEvents((prev) => [...prev, sessionEvent]);
            }
          }
        } catch (error) {
          console.error('Failed to parse event:', error);
        }
      };

      eventListeners.set(eventType, listener);
      eventSource.addEventListener(eventType, listener);
    });

    // Connection event listener
    const connectionListener = (_event: Event) => {
      setConnected(true);

      // Add a local connection event to the events list
      const connectionEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: sessionId, // Use session ID as thread ID for system messages
        timestamp: new Date(),
        data: { content: 'Connected to session stream' },
      };
      setAllEvents((prev) => [...prev, connectionEvent]);
    };

    eventSource.addEventListener('connection', connectionListener);

    eventSource.onerror = (_error) => {
      setConnected(false);

      // Add error event
      const errorEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: sessionId,
        timestamp: new Date(),
        data: { content: 'Connection lost' },
      };
      setAllEvents((prev) => [...prev, errorEvent]);
    };

    // Cleanup function
    return () => {
      // Remove all event listeners before closing
      eventListeners.forEach((listener, eventType) => {
        eventSource.removeEventListener(eventType, listener);
      });
      eventSource.removeEventListener('connection', connectionListener);
      eventSource.close();
      setConnected(false);
    };
  }, [sessionId, loadConversationHistory]);

  // Clear events when session changes
  useEffect(() => {
    if (!sessionId) {
      setAllEvents([]);
      setApprovalRequest(null);
    }
  }, [sessionId]);

  // Check for pending approvals when agent is selected
  useEffect(() => {
    if (sessionId && selectedAgent) {
      void checkPendingApprovals(sessionId, selectedAgent);
    } else {
      // Clear approval request when no agent is selected
      setApprovalRequest(null);
    }
  }, [sessionId, selectedAgent, checkPendingApprovals]);

  return {
    allEvents,
    filteredEvents,
    approvalRequest,
    loadingHistory,
    connected,
    clearApprovalRequest,
  };
}
