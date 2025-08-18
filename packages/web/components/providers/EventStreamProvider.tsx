// ABOUTME: Context provider for event stream connections and session API
// ABOUTME: Eliminates prop drilling by centralizing event handling and streaming (tool approvals now in ToolApprovalProvider)

'use client';

import React, { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { useAgentEvents as useAgentEventsHook } from '@/hooks/useAgentEvents';
import { useEventStream as useEventStreamHook } from '@/hooks/useEventStream';
import { useSessionAPI as useSessionAPIHook } from '@/hooks/useSessionAPI';
import { useToolApprovalContext } from './ToolApprovalProvider';
import type { ThreadId } from '@/types/core';
import type { LaceEvent } from '~/threads/types';
import type { StreamConnection } from '@/types/stream-events';
import type { PendingApproval } from '@/types/api';

// Types for the context
interface EventStreamConnection {
  connection: StreamConnection;
  lastEvent?: LaceEvent;
  sendCount: number;
  close: () => void;
  reconnect: () => void;
}

interface AgentEventsState {
  events: LaceEvent[];
  loadingHistory: boolean;
  addAgentEvent: (event: LaceEvent) => void;
}

interface SessionAPIActions {
  sendMessage: (agentId: ThreadId, message: string) => Promise<boolean>;
  stopAgent: (agentId: ThreadId) => Promise<boolean>;
}

interface EventStreamContextType {
  // Event stream connection
  eventStream: EventStreamConnection;

  // Agent events
  agentEvents: AgentEventsState;

  // Session API
  sessionAPI: SessionAPIActions;

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

  // Agent events hook (no longer manages approvals internally)
  const { events, loadingHistory, addAgentEvent } = useAgentEventsHook(agentId, false);

  // Session API hook
  const sessionAPI = useSessionAPIHook();

  // Agent state change handler
  const handleAgentStateChangeCallback = useCallback(
    (agentId: string, fromState: string, toState: string) => {
      if (onAgentStateChange) {
        onAgentStateChange(agentId, fromState, toState);
      }
    },
    [onAgentStateChange]
  );

  // Event stream hook with all event handlers
  const eventStreamResult = useEventStreamHook({
    projectId: projectId || undefined,
    sessionId: sessionId || undefined,
    threadIds: agentId ? [agentId] : undefined,
    onConnect: () => {
      // Event stream connected
    },
    onError: (error) => {
      console.error('Event stream error:', error);
    },
    // Agent event handlers
    onUserMessage: addAgentEvent,
    onAgentMessage: addAgentEvent,
    onToolCall: addAgentEvent,
    onToolResult: addAgentEvent,
    // Agent state changes
    onAgentStateChange: handleAgentStateChangeCallback,
    // Tool approval requests
    onApprovalRequest: handleApprovalRequest,
    // Tool approval responses
    onApprovalResponse: handleApprovalResponse,
  });

  // Create context value
  const contextValue: EventStreamContextType = useMemo(
    () => ({
      eventStream: {
        connection: eventStreamResult.connection,
        lastEvent: eventStreamResult.lastEvent,
        sendCount: eventStreamResult.sendCount,
        close: eventStreamResult.close,
        reconnect: eventStreamResult.reconnect,
      },

      agentEvents: {
        events,
        loadingHistory,
        addAgentEvent,
      },

      sessionAPI: {
        sendMessage: sessionAPI.sendMessage,
        stopAgent: sessionAPI.stopAgent,
      },

      onAgentStateChange: handleAgentStateChangeCallback,
    }),
    [
      eventStreamResult.connection,
      eventStreamResult.lastEvent,
      eventStreamResult.sendCount,
      eventStreamResult.close,
      eventStreamResult.reconnect,
      events,
      loadingHistory,
      addAgentEvent,
      sessionAPI.sendMessage,
      sessionAPI.stopAgent,
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

// Convenience hooks for specific functionality
export function useEventStream() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useEventStream must be used within EventStreamProvider');
  }

  return {
    connection: context.eventStream.connection,
    lastEvent: context.eventStream.lastEvent,
    sendCount: context.eventStream.sendCount,
    close: context.eventStream.close,
    reconnect: context.eventStream.reconnect,
  };
}

export function useSessionEvents() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useSessionEvents must be used within EventStreamProvider');
  }

  return context.agentEvents;
}

export function useSessionAPI() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useSessionAPI must be used within EventStreamProvider');
  }

  return context.sessionAPI;
}

// Note: useToolApprovals is now provided by ToolApprovalProvider
// Import useToolApprovalContext from ToolApprovalProvider instead
