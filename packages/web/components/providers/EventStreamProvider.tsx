// ABOUTME: Context provider for event stream connections and session API
// ABOUTME: Eliminates prop drilling by centralizing event handling and streaming (tool approvals now in ToolApprovalProvider)

'use client';

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAgentEvents as useAgentEventsHook } from '@lace/web/hooks/useAgentEvents';
import { useEventStream as useEventStreamHook } from '@lace/web/hooks/useEventStream';
import { useSessionAPI as useSessionAPIHook } from '@lace/web/hooks/useSessionAPI';
import { useAgentAPI as useAgentAPIHook } from '@lace/web/hooks/useAgentAPI';
import { useToolApprovalContext } from './ToolApprovalProvider';
import { useSessionContext } from './SessionProvider';
import type { ThreadId, WorkspaceSessionId } from '@lace/web/types/core';
import type { AppEvent } from '@lace/web/types/app-events';
import { isWebEvent, isProtocolEvent } from '@lace/web/types/app-events';
import type { StreamConnection } from '@lace/web/types/stream-events';
import type { PendingApproval } from '@lace/web/types/api';

// Types for the context
interface EventStreamConnection {
  connection: StreamConnection;
  lastEvent?: AppEvent;
  close: () => void;
  reconnect: () => void;
}

interface AgentEventsState {
  events: AppEvent[];
  loadingHistory: boolean;
  addAgentEvent: (event: AppEvent) => void;
}

interface AgentAPIActions {
  sendMessage: (agentId: ThreadId, message: string) => Promise<boolean>;
  stopAgent: (agentId: ThreadId) => Promise<boolean>;
}

export interface CompactionState {
  isCompacting: boolean;
  isAuto: boolean;
  compactingAgentId?: string;
}

interface EventStreamContextType {
  // Event stream connection
  eventStream: EventStreamConnection;

  // Agent events
  agentEvents: AgentEventsState;

  // Compaction state
  compactionState: CompactionState;

  // Agent API
  agentAPI: AgentAPIActions;

  // Agent state handling
  onAgentStateChange?: (agentId: string, fromState: string, toState: string) => void;
}

const EventStreamContext = createContext<EventStreamContextType | null>(null);

interface EventStreamProviderProps {
  children: ReactNode;
  projectId: string | null;
  sessionId: WorkspaceSessionId | null;
  agentId: ThreadId | null;
  onAgentStateChange?: (agentId: string, fromState: string, toState: string) => void;
}

export function EventStreamProvider({
  children,
  projectId,
  sessionId,
  agentId,
  onAgentStateChange,
}: EventStreamProviderProps) {
  // Get tool approval handlers from ToolApprovalProvider
  const { handleApprovalRequest, handleApprovalResponse } = useToolApprovalContext();

  // Get agent management functions from SessionProvider
  const { updateAgentState } = useSessionContext();

  // Agent events hook (no longer manages approvals internally)
  const { events, loadingHistory, addAgentEvent, updateEventVisibility, clearEvents } =
    useAgentEventsHook(agentId, false);

  // API hooks
  const sessionAPI = useSessionAPIHook();
  const agentAPIBase = useAgentAPIHook();

  // Wrap sendMessage to add optimistic USER_MESSAGE events
  const sendMessageWithOptimisticUpdate = useCallback(
    async (agentIdArg: ThreadId, message: string): Promise<boolean> => {
      // Add optimistic USER_MESSAGE before sending
      const optimisticEvent: AppEvent = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: message,
        agentSessionId: agentIdArg,
        workspaceSessionId: sessionId ?? undefined,
      };
      addAgentEvent(optimisticEvent);

      // Send to server
      return agentAPIBase.sendMessage(agentIdArg, message);
    },
    [addAgentEvent, agentAPIBase, sessionId]
  );

  const agentAPI = useMemo(
    () => ({
      sendMessage: sendMessageWithOptimisticUpdate,
      stopAgent: agentAPIBase.stopAgent,
      error: agentAPIBase.error,
    }),
    [sendMessageWithOptimisticUpdate, agentAPIBase.stopAgent, agentAPIBase.error]
  );

  // Streaming content now handled by useProcessedEvents hook

  // Compaction state
  const [compactionState, setCompactionState] = useState<CompactionState>({
    isCompacting: false,
    isAuto: false,
    compactingAgentId: undefined,
  });

  // Agent state change handler
  const handleAgentStateChangeCallback = useCallback(
    (agentId: string, fromState: string, toState: string) => {
      // Update the agent state in the SessionProvider
      updateAgentState(agentId, toState);

      // Also call the optional callback prop
      if (onAgentStateChange) {
        onAgentStateChange(agentId, fromState, toState);
      }
    },
    [updateAgentState, onAgentStateChange]
  );

  // Compaction event handlers - compaction is ONLY from ProtocolEvents (compaction_start/compaction_complete)
  const handleCompactionStart = useCallback((event: AppEvent) => {
    if (isProtocolEvent(event) && event.update.type === 'compaction_start') {
      setCompactionState({
        isCompacting: true,
        isAuto: false,
        compactingAgentId: event.agentSessionId,
      });
    }
  }, []);

  const handleCompactionComplete = useCallback((_event: AppEvent) => {
    setCompactionState({
      isCompacting: false,
      isAuto: false,
      compactingAgentId: undefined,
    });
  }, []);

  // EVENT_UPDATED handler
  const handleEventUpdated = useCallback(
    (event: AppEvent) => {
      // Handle EVENT_UPDATED WebEvent
      if (isWebEvent(event) && event.type === 'EVENT_UPDATED') {
        const updateData = event.data as { eventId?: string; visibleToModel?: boolean } | undefined;
        if (updateData?.eventId && typeof updateData.visibleToModel === 'boolean') {
          updateEventVisibility(updateData.eventId, updateData.visibleToModel);
        }
      }
    },
    [updateEventVisibility]
  );

  // Session changed handler (e.g., from /clear command)
  const handleSessionChanged = useCallback(
    (data: { newSessionId: string; reason?: string; agentSessionId: string }) => {
      // Clear events when the agent's session is reset
      clearEvents();
      // Note: This is informational, not an error, but we use console.warn
      // because console.log is not allowed by linting rules
      console.warn(
        `[EventStreamProvider] Session changed for agent ${data.agentSessionId}: ${data.reason || 'unknown reason'}, new session: ${data.newSessionId}`
      );
    },
    [clearEvents]
  );

  const handleAgentError = useCallback(
    (event: AppEvent) => {
      // Add AGENT_ERROR event directly to timeline - don't convert to AGENT_MESSAGE
      // The UI should handle AGENT_ERROR events natively
      addAgentEvent(event);
    },
    [addAgentEvent]
  );

  // Memoize threadIds to prevent unnecessary re-subscriptions
  const threadIds = useMemo(() => {
    return agentId ? [agentId] : undefined;
  }, [agentId]);

  // Create a single stable event handler to ensure consistent references
  const stableAddAgentEvent = useCallback(
    (event: AppEvent) => {
      if ('type' in event && event.type === 'TOOL_APPROVAL_RESPONSE') {
        return;
      }
      addAgentEvent(event);
    },
    [addAgentEvent]
  );

  // Create the options object with stable references
  const eventStreamOptions = useMemo(() => {
    const options = {
      projectId: projectId || undefined,
      sessionId: sessionId || undefined,
      threadIds,
      onConnect: () => {
        // Event stream connected
      },
      onError: (error: unknown) => {
        console.error('Event stream error:', error);
      },
      onAgentError: handleAgentError,
      onAppEvent: stableAddAgentEvent,
      // Agent state changes
      onAgentStateChange: handleAgentStateChangeCallback,
      // Tool approval requests
      onApprovalRequest: handleApprovalRequest,
      // Tool approval responses
      onApprovalResponse: handleApprovalResponse,
      // Compaction events
      onCompactionStart: handleCompactionStart,
      onCompactionComplete: handleCompactionComplete,
      onEventUpdated: handleEventUpdated,
      // Session change events (e.g., /clear)
      onSessionChanged: handleSessionChanged,
    };

    return options;
  }, [
    projectId,
    sessionId,
    threadIds,
    stableAddAgentEvent,
    handleAgentStateChangeCallback,
    handleApprovalRequest,
    handleApprovalResponse,
    handleCompactionStart,
    handleCompactionComplete,
    handleEventUpdated,
    handleAgentError,
    handleSessionChanged,
  ]);

  // Event stream hook with stable options object
  const eventStreamResult = useEventStreamHook(eventStreamOptions);

  // Create context value
  const contextValue: EventStreamContextType = useMemo(
    () => ({
      eventStream: {
        connection: eventStreamResult.connection,
        lastEvent: eventStreamResult.lastEvent,
        close: eventStreamResult.close,
        reconnect: eventStreamResult.reconnect,
      },

      agentEvents: {
        events,
        loadingHistory,
        addAgentEvent,
      },

      // Streaming content removed - now handled by useProcessedEvents

      // Compaction state
      compactionState,

      agentAPI: {
        sendMessage: sendMessageWithOptimisticUpdate,
        stopAgent: agentAPIBase.stopAgent,
      },

      onAgentStateChange: handleAgentStateChangeCallback,
    }),
    [
      eventStreamResult.connection,
      eventStreamResult.lastEvent,
      eventStreamResult.close,
      eventStreamResult.reconnect,
      events,
      loadingHistory,
      addAgentEvent,
      compactionState,
      sendMessageWithOptimisticUpdate,
      agentAPIBase.stopAgent,
      handleAgentStateChangeCallback,
    ]
  );

  return <EventStreamContext.Provider value={contextValue}>{children}</EventStreamContext.Provider>;
}

// Main hook for accessing all event stream functionality
export function useEventStreamContext(): EventStreamContextType {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useEventStreamContext must be used within EventStreamProvider');
  }

  return context;
}

// Note: useEventStreamConnection removed - no production components use it

export function useSessionEvents() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useSessionEvents must be used within EventStreamProvider');
  }

  return context.agentEvents;
}

export function useAgentAPI() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useAgentAPI must be used within EventStreamProvider');
  }

  return context.agentAPI;
}

export function useCompactionState() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useCompactionState must be used within EventStreamProvider');
  }

  return context.compactionState;
}

// Note: useToolApprovals is now provided by ToolApprovalProvider
// Import useToolApprovalContext from ToolApprovalProvider instead
