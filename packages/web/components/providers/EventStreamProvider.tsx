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
  sendCount: number;
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

interface EventStreamContextType {
  // Event stream connection
  eventStream: EventStreamConnection;

  // Agent events
  agentEvents: AgentEventsState;

  // Streaming content
  streamingContent: string | null;

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

  // Streaming content state
  const [streamingContent, setStreamingContent] = useState<string | null>(null);

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

  // Agent token handler for streaming content
  const handleAgentToken = useCallback((event: LaceEvent) => {
    if (event.data && typeof event.data === 'object' && 'token' in event.data) {
      const tokenData = event.data as { token: string };
      // console.warn('[STREAMING] Adding token:', JSON.stringify(tokenData.token));
      setStreamingContent((prev) => {
        const newContent = (prev || '') + tokenData.token;
        // console.warn('[STREAMING] New content length:', newContent.length);
        return newContent;
      });
    }
  }, []);

  // Agent message handler to clear streaming content when complete
  const stableAddAgentEventWithStreaming = useCallback(
    (event: LaceEvent) => {
      // Clear streaming content when we get the complete agent message or a new user message
      if (event.type === 'AGENT_MESSAGE' || event.type === 'USER_MESSAGE') {
        setStreamingContent(null);
      }
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
    (event) => {
      addAgentEvent(event);
    },
    [addAgentEvent]
  );

  // Create the options object with stable references
  const eventStreamOptions = useMemo(
    () => ({
      projectId: projectId || undefined,
      sessionId: sessionId || undefined,
      threadIds,
      onConnect: () => {
        // Event stream connected
      },
      onError: (error) => {
        console.error('Event stream error:', error);
      },
      // Agent event handlers - use single stable handler to prevent stale closures
      onUserMessage: stableAddAgentEventWithStreaming,
      onAgentMessage: stableAddAgentEventWithStreaming,
      onAgentToken: handleAgentToken,
      onToolCall: stableAddAgentEvent,
      onToolResult: stableAddAgentEvent,
      // Agent state changes
      onAgentStateChange: handleAgentStateChangeCallback,
      // Tool approval requests
      onApprovalRequest: handleApprovalRequest,
      // Tool approval responses
      onApprovalResponse: handleApprovalResponse,
    }),
    [
      projectId,
      sessionId,
      threadIds,
      stableAddAgentEvent,
      stableAddAgentEventWithStreaming,
      handleAgentToken,
      handleAgentStateChangeCallback,
      handleApprovalRequest,
      handleApprovalResponse,
    ]
  );

  // Event stream hook with stable options object
  const eventStreamResult = useEventStreamHook(eventStreamOptions);

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

      // Streaming content
      streamingContent,

      agentAPI: {
        sendMessage: agentAPI.sendMessage,
        stopAgent: agentAPI.stopAgent,
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
      streamingContent,
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

export function useAgentAPI() {
  const context = useContext(EventStreamContext);

  if (!context) {
    throw new Error('useAgentAPI must be used within EventStreamProvider');
  }

  return context.agentAPI;
}

// Note: useToolApprovals is now provided by ToolApprovalProvider
// Import useToolApprovalContext from ToolApprovalProvider instead
