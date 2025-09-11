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
import { useAgentEvents as useAgentEventsHook } from '@/hooks/useAgentEvents';
import { useEventStream as useEventStreamHook } from '@/hooks/useEventStream';
import { useSessionAPI as useSessionAPIHook } from '@/hooks/useSessionAPI';
import { useAgentAPI as useAgentAPIHook } from '@/hooks/useAgentAPI';
import { useToolApprovalContext } from './ToolApprovalProvider';
import { useAgentContext } from './AgentProvider';
import type { ThreadId } from '@/types/core';
import type { LaceEvent } from '~/threads/types';
import type { StreamConnection } from '@/types/stream-events';
import type { PendingApproval } from '@/types/api';

// Types for the context
interface EventStreamConnection {
  connection: StreamConnection;
  lastEvent?: LaceEvent;
  close: () => void;
  reconnect: () => void;
}

interface AgentEventsState {
  events: LaceEvent[];
  loadingHistory: boolean;
  addAgentEvent: (event: LaceEvent) => void;
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
  sessionId: ThreadId | null;
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

  // Get agent management functions from AgentProvider
  const { updateAgentState } = useAgentContext();

  // Agent events hook (no longer manages approvals internally)
  const { events, loadingHistory, addAgentEvent } = useAgentEventsHook(agentId, false);

  // API hooks
  const sessionAPI = useSessionAPIHook();
  const agentAPI = useAgentAPIHook();

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
      // Update the agent state in the AgentProvider
      updateAgentState(agentId, toState);

      // Also call the optional callback prop
      if (onAgentStateChange) {
        onAgentStateChange(agentId, fromState, toState);
      }
    },
    [updateAgentState, onAgentStateChange]
  );

  // Agent token handler - forward events to useProcessedEvents for token aggregation
  const handleAgentToken = useCallback(
    (event: LaceEvent) => {
      // Forward AGENT_TOKEN events so useProcessedEvents can aggregate them
      addAgentEvent(event);
    },
    [addAgentEvent]
  );

  // Compaction event handlers
  const handleCompactionStart = useCallback((event: LaceEvent) => {
    if (event.data && typeof event.data === 'object' && 'auto' in event.data) {
      const compactionData = event.data as { auto: boolean };
      setCompactionState({
        isCompacting: true,
        isAuto: compactionData.auto,
        compactingAgentId: event.context?.threadId,
      });
    }
  }, []);

  const handleCompactionComplete = useCallback((event: LaceEvent) => {
    setCompactionState({
      isCompacting: false,
      isAuto: false,
      compactingAgentId: undefined,
    });
  }, []);

  const handleAgentError = useCallback(
    (event: LaceEvent) => {
      // Add AGENT_ERROR event directly to timeline - don't convert to AGENT_MESSAGE
      // The UI should handle AGENT_ERROR events natively
      addAgentEvent(event);
    },
    [addAgentEvent]
  );

  // Agent message handler
  const stableAddAgentEventMessage = useCallback(
    (event: LaceEvent) => {
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
    (event: LaceEvent) => {
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
      // Agent event handlers - use single stable handler to prevent stale closures
      onUserMessage: stableAddAgentEventMessage,
      onAgentMessage: stableAddAgentEventMessage,
      onAgentToken: handleAgentToken,
      onToolCall: stableAddAgentEvent,
      onToolResult: stableAddAgentEvent,
      // Session events (includes all LaceEvent types like AGENT_SUMMARY_UPDATED)
      onSessionEvent: stableAddAgentEvent, // Handles all session-level events including agent summaries
      // Agent state changes
      onAgentStateChange: handleAgentStateChangeCallback,
      // Tool approval requests
      onApprovalRequest: handleApprovalRequest,
      // Tool approval responses
      onApprovalResponse: handleApprovalResponse,
      // Compaction events
      onCompactionStart: handleCompactionStart,
      onCompactionComplete: handleCompactionComplete,
    };

    return options;
  }, [
    projectId,
    sessionId,
    threadIds,
    stableAddAgentEvent,
    stableAddAgentEventMessage,
    handleAgentToken,
    handleAgentStateChangeCallback,
    handleApprovalRequest,
    handleApprovalResponse,
    handleCompactionStart,
    handleCompactionComplete,
    handleAgentError,
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
        sendMessage: agentAPI.sendMessage,
        stopAgent: agentAPI.stopAgent,
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
      agentAPI.sendMessage,
      agentAPI.stopAgent,
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
