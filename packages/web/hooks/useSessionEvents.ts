// ABOUTME: Custom hook for managing session events and SSE connections
// ABOUTME: Handles event loading, filtering, and real-time updates for agent conversations

import React, { useState, useEffect, useCallback } from 'react';
import { SessionEvent, ThreadId, ToolApprovalRequestData, PendingApproval } from '@/types/api';
import { isApiError } from '@/types/api';
import { getAllEventTypes } from '@/types/events';
import { z } from 'zod';

// Zod schemas matching the TypeScript types
const ToolApprovalRequestDataSchema = z.object({
  requestId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  isReadOnly: z.boolean(),
  toolDescription: z.string().optional(),
  toolAnnotations: z
    .object({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      riskLevel: z.enum(['safe', 'moderate', 'destructive']).optional(),
    })
    .optional(),
  riskLevel: z.enum(['safe', 'moderate', 'destructive']),
});

const PendingApprovalSchema = z.object({
  toolCallId: z.string(),
  toolCall: z.object({
    name: z.string(),
    arguments: z.unknown(),
  }),
  requestData: ToolApprovalRequestDataSchema,
  requestedAt: z.string(),
});

const PendingApprovalsResponseSchema = z.object({
  pendingApprovals: z.array(PendingApprovalSchema),
});

interface UseSessionEventsReturn {
  // Event data
  allEvents: SessionEvent[];
  filteredEvents: SessionEvent[];

  // Tool approval - updated for multiple approvals per spec Phase 3.2
  pendingApprovals: PendingApproval[];

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
  // Add unique ID to track hook instances (for debugging)
  const hookId = React.useRef(Math.random().toString(36).substr(2, 9));
  const [allEvents, setAllEvents] = useState<SessionEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [connected, setConnected] = useState(false);

  // Filter events for the selected agent
  const filteredEvents = selectedAgent
    ? (allEvents?.filter((event) => event.threadId === selectedAgent) ?? [])
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

      // Convert string timestamps to Date objects and filter out approval events
      const eventsWithDateTimestamps: SessionEvent[] = (historyData.events || [])
        .filter((event) => {
          // Filter out approval events from history - they should not appear in timeline
          return event.type !== 'TOOL_APPROVAL_REQUEST' && event.type !== 'TOOL_APPROVAL_RESPONSE';
        })
        .map((event) => ({
          ...event,
          timestamp: new Date(event.timestamp),
        }));

      // DEBUG: Log tool events during persistence reload
      const toolEvents = eventsWithDateTimestamps.filter(
        (e) => e.type === 'TOOL_CALL' || e.type === 'TOOL_RESULT'
      );
      if (toolEvents.length > 0) {
        console.group(`🔧 RELOAD EVENTS: Found ${toolEvents.length} tool events`);
        toolEvents.forEach((event) => {
          console.log(`📊 ${event.type}:`, {
            type: event.type,
            threadId: event.threadId,
            dataKeys: Object.keys(event.data || {}),
            data: event.data,
          });
        });
        console.groupEnd();
      }

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

      // Runtime type validation using Zod
      const parseResult = PendingApprovalsResponseSchema.safeParse(data);
      if (!parseResult.success) {
        console.error('Invalid pending approvals response format:', parseResult.error);
        return;
      }

      const approvalData = parseResult.data;

      // Set all pending approvals (spec Phase 3.2: support multiple approvals)
      if (approvalData.pendingApprovals && approvalData.pendingApprovals.length > 0) {
        const approvals = approvalData.pendingApprovals.map((approval) => ({
          toolCallId: approval.toolCallId,
          toolCall: approval.toolCall as { name: string; arguments: unknown },
          requestedAt: new Date(approval.requestedAt),
          requestData: approval.requestData as ToolApprovalRequestData,
        }));

        setPendingApprovals(approvals);
      } else {
        setPendingApprovals([]);
      }
    } catch (error) {
      console.error('Failed to check pending approvals:', error);
    }
  }, []);

  // Clear approval request
  const clearApprovalRequest = useCallback(() => {
    setPendingApprovals([]);
  }, []);

  // SSE connection effect
  useEffect(() => {
    // SSE effect running for session

    if (!sessionId) {
      setAllEvents([]);
      setConnected(false);
      return;
    }

    // Load initial history
    void loadConversationHistory(sessionId);

    // Set up SSE connection
    // Creating new EventSource for session
    const eventSource = new EventSource(`/api/sessions/${sessionId}/events/stream`);

    // Store event listeners for cleanup
    const eventListeners = new Map<string, (event: MessageEvent) => void>();

    // Listen to all event types
    const eventTypes = getAllEventTypes();

    // Registering event listeners for all event types

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

            // Handle approval events separately (spec Phase 3.2: multiple approval support)
            if (eventData.type === 'TOOL_APPROVAL_REQUEST') {
              const approvalData = eventData.data as ToolApprovalRequestData;

              // Create PendingApproval from the event data
              const pendingApproval: PendingApproval = {
                toolCallId: approvalData.requestId,
                toolCall: {
                  name: approvalData.toolName,
                  arguments: approvalData.input,
                },
                requestedAt: eventData.timestamp
                  ? typeof eventData.timestamp === 'string'
                    ? new Date(eventData.timestamp)
                    : eventData.timestamp
                  : new Date(),
                requestData: approvalData,
              };

              setPendingApprovals((prev) => {
                // Check if this approval already exists to prevent duplicates
                const existingApproval = prev.find((p) => p.toolCallId === approvalData.requestId);
                if (existingApproval) {
                  return prev;
                }

                const updated = [...prev, pendingApproval];
                return updated;
              });

              // Don't add approval request events to timeline
              return;
            } else if (eventData.type === 'TOOL_APPROVAL_RESPONSE') {
              // Remove approved item from pending list (spec Phase 3.2)
              const responseData = eventData.data as { toolCallId: string; decision: string };

              setPendingApprovals((prev) => {
                // Check if the approval actually exists before trying to remove it
                const existingApproval = prev.find((p) => p.toolCallId === responseData.toolCallId);
                if (!existingApproval) {
                  return prev;
                }

                const updated = prev.filter(
                  (approval) => approval.toolCallId !== responseData.toolCallId
                );
                return updated;
              });

              // Don't add approval response events to timeline
              return;
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

              // DEBUG: Log all events during real-time streaming
              if (sessionEvent.type === 'TOOL_CALL' || sessionEvent.type === 'TOOL_RESULT') {
                console.group(`🔧 REAL-TIME EVENT: ${sessionEvent.type}`);
                console.log('📊 Event Structure:', {
                  type: sessionEvent.type,
                  threadId: sessionEvent.threadId,
                  timestamp: sessionEvent.timestamp,
                  dataKeys: Object.keys(sessionEvent.data || {}),
                });
                console.log('📦 Event Data:', sessionEvent.data);
                console.log('🔍 Full Event:', sessionEvent);
                console.groupEnd();
              }

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

      // Add connection event only if the last message wasn't already "Connected to session stream"
      setAllEvents((prev) => {
        const lastEvent = prev[prev.length - 1];
        const isLastEventConnectionRestored =
          lastEvent?.type === 'LOCAL_SYSTEM_MESSAGE' &&
          lastEvent?.data?.content === 'Connected to session stream';

        if (isLastEventConnectionRestored) {
          // Don't add duplicate connection restored messages
          return prev;
        }

        const connectionEvent: SessionEvent = {
          type: 'LOCAL_SYSTEM_MESSAGE',
          threadId: sessionId, // Use session ID as thread ID for system messages
          timestamp: new Date(),
          data: { content: 'Connected to session stream' },
        };
        return [...prev, connectionEvent];
      });

      // Phase 3.5: Recovery on Connection - check for pending approvals when connected
      if (selectedAgent) {
        void checkPendingApprovals(sessionId, selectedAgent);
      }
    };

    eventSource.addEventListener('connection', connectionListener);

    eventSource.onerror = (_error) => {
      setConnected(false);

      // Add error event only if the last message wasn't already "Connection lost"
      setAllEvents((prev) => {
        const lastEvent = prev[prev.length - 1];
        const isLastEventConnectionLost =
          lastEvent?.type === 'LOCAL_SYSTEM_MESSAGE' &&
          lastEvent?.data?.content === 'Connection lost';

        if (isLastEventConnectionLost) {
          // Don't add duplicate connection lost messages
          return prev;
        }

        const errorEvent: SessionEvent = {
          type: 'LOCAL_SYSTEM_MESSAGE',
          threadId: sessionId,
          timestamp: new Date(),
          data: { content: 'Connection lost' },
        };
        return [...prev, errorEvent];
      });
    };

    // Cleanup function
    return () => {
      // Cleaning up SSE connection
      // Remove all event listeners before closing
      eventListeners.forEach((listener, eventType) => {
        eventSource.removeEventListener(eventType, listener);
      });
      eventSource.removeEventListener('connection', connectionListener);
      eventSource.close();
      setConnected(false);
    };
  }, [sessionId]);

  // Clear events when session changes
  useEffect(() => {
    if (!sessionId) {
      setAllEvents([]);
      setPendingApprovals([]);
    }
  }, [sessionId]);

  // Check for pending approvals when agent is selected
  useEffect(() => {
    if (sessionId && selectedAgent) {
      void checkPendingApprovals(sessionId, selectedAgent);
    } else {
      // Clear approvals when no agent is selected
      setPendingApprovals([]);
    }
  }, [sessionId, selectedAgent]);

  return {
    allEvents,
    filteredEvents,
    pendingApprovals,
    loadingHistory,
    connected,
    clearApprovalRequest,
  };
}
