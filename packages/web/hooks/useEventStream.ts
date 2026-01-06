// ABOUTME: Event stream hook using SSE store singleton
// ABOUTME: Supports both legacy LaceEvent and new AppEvent (protocol/web) types

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSSEStore } from '@lace/web/lib/sse-store';
import type { LaceEvent, AgentErrorData } from '@lace/web/types/core';
import type { SessionPendingApproval } from '@lace/web/types/api';
import type { AppEvent } from '@lace/web/types/app-events';
import type { ProtocolEvent } from '@lace/web/types/protocol-events';
import type { WebEvent } from '@lace/web/types/web-events';
import { isProtocolEvent, isPermissionRequestEvent, isWebEvent } from '@lace/web/types/app-events';

// Runtime type guard for AgentErrorData
function isAgentErrorData(value: unknown): value is AgentErrorData {
  return (
    value !== null &&
    typeof value === 'object' &&
    'errorType' in value &&
    'message' in value &&
    'context' in value &&
    'isRetryable' in value &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

interface ProjectEvent {
  type: 'project:created' | 'project:updated' | 'project:deleted';
  projectId: string;
  project: {
    id: string;
    name: string;
    description?: string;
    path: string;
  };
  context: {
    actor: string;
    isHuman: boolean;
  };
  timestamp: Date;
}

export interface AgentEvent {
  type: 'agent:spawned' | 'agent:started' | 'agent:stopped';
  taskId?: string;
  agentThreadId: string;
  providerInstanceId: string;
  modelId: string;
  context: {
    actor: string;
    isHuman: boolean;
  };
  timestamp: Date;
}

interface GlobalEvent {
  type: 'system:maintenance' | 'system:update' | 'system:notification';
  message: string;
  severity: 'info' | 'warning' | 'error';
  context: {
    actor: string;
    isHuman: boolean;
  };
  timestamp: Date;
}

interface EventHandlers {
  // Session events (legacy LaceEvent)
  onSessionEvent?: (event: LaceEvent) => void;
  onUserMessage?: (event: LaceEvent) => void;
  onAgentMessage?: (event: LaceEvent) => void;
  onAgentToken?: (event: LaceEvent) => void;
  onToolCall?: (event: LaceEvent) => void;
  onToolResult?: (event: LaceEvent) => void;
  onSystemMessage?: (event: LaceEvent) => void;
  onAgentStateChange?: (agentId: string, from: string, to: string) => void;

  // Approval events
  onApprovalRequest?: (approval: SessionPendingApproval) => void;
  onApprovalResponse?: (toolCallId: string) => void;

  // Project events
  onProjectEvent?: (event: ProjectEvent) => void;
  onProjectCreated?: (event: ProjectEvent) => void;
  onProjectUpdated?: (event: ProjectEvent) => void;
  onProjectDeleted?: (event: ProjectEvent) => void;

  // Session events
  onSessionInfo?: (event: LaceEvent) => void;

  // Agent events
  onAgentEvent?: (event: AgentEvent) => void;
  onAgentSpawned?: (event: AgentEvent) => void;
  onAgentStarted?: (event: AgentEvent) => void;
  onAgentStopped?: (event: AgentEvent) => void;

  // Compaction events
  onCompactionStart?: (event: LaceEvent) => void;
  onCompactionComplete?: (event: LaceEvent) => void;
  onEventUpdated?: (event: LaceEvent) => void;

  // Global events
  onGlobalEvent?: (event: GlobalEvent) => void;
  onSystemNotification?: (event: GlobalEvent) => void;

  // Error event handlers
  onAgentError?: (event: LaceEvent) => void;

  // Connection events (deprecated but kept for compatibility)
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;

  // NEW: Protocol event handlers (AppEvent system)
  onAppEvent?: (event: AppEvent) => void;
  onProtocolTextDelta?: (data: { text: string; agentSessionId: string; streamSeq: number }) => void;
  onProtocolThinking?: (data: { text: string; agentSessionId: string }) => void;
  onProtocolToolUse?: (data: {
    toolCallId: string;
    name: string;
    input: unknown;
    status: string;
    result?: unknown;
  }) => void;
  onProtocolTurnStart?: (data: { turnId: string; agentSessionId: string }) => void;
  onProtocolTurnEnd?: (data: {
    turnId: string;
    content: unknown[];
    agentSessionId: string;
  }) => void;
  onProtocolError?: (data: { code: string; message: string; phase?: string }) => void;
  onProtocolUsage?: (data: { inputTokens: number; outputTokens: number }) => void;
  onProtocolPermissionRequest?: (data: {
    toolCallId: string;
    tool: string;
    resource: string;
    options: Array<{ optionId: string; label: string }>;
  }) => void;

  // NEW: Web event handlers
  onWebUserMessage?: (data: { content: string; agentSessionId: string }) => void;
  onWebAgentStateChange?: (data: {
    agentSessionId: string;
    previousState: string;
    newState: string;
  }) => void;
}

export interface UseEventStreamOptions extends EventHandlers {
  projectId?: string;
  sessionId?: string;
  threadIds?: string[];
  includeGlobal?: boolean;

  // Prevents calling onError for AGENT_ERROR events to avoid duplicate handling
  treatAgentErrorAsGeneric?: boolean;

  // These are now ignored but kept for API compatibility
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export interface UseEventStreamResult {
  connection: {
    connected: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    lastEventId?: string;
  };
  lastEvent?: LaceEvent;
  close: () => void;
  reconnect: () => void;
}

export function useEventStream(options: UseEventStreamOptions): UseEventStreamResult {
  const [lastEvent, setLastEvent] = useState<LaceEvent>();
  const subscriptionIdRef = useRef<string | null>(null);
  const optionsRef = useRef(options);

  // Update options ref on every render to capture fresh handlers
  optionsRef.current = options;

  // Build filter from options (memoized for performance)
  // Use deep comparison for threadIds array to prevent unnecessary re-subscriptions
  const stableThreadIds = useMemo(
    () => options.threadIds,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(options.threadIds)] // Deep comparison - ignore exhaustive-deps for this dependency
  );

  const filter = useMemo(() => {
    return {
      projectIds: options.projectId ? [options.projectId] : undefined,
      sessionIds: options.sessionId ? [options.sessionId] : undefined,
      threadIds: stableThreadIds,
      eventTypes: undefined, // Could be added later
    };
  }, [
    options.projectId,
    options.sessionId,
    stableThreadIds, // Stable reference with deep comparison
  ]);

  // Subscribe/unsubscribe effect - only runs when filter changes
  useEffect(() => {
    const store = useSSEStore.getState();

    // Handle LaceEvent (legacy) callback
    const handleLaceEvent = (event: LaceEvent, currentOptions: UseEventStreamOptions) => {
      setLastEvent(event);

      // Call general handler first
      currentOptions.onSessionEvent?.(event);

      // Route to specific handlers based on event type
      switch (event.type) {
        case 'USER_MESSAGE':
          currentOptions.onUserMessage?.(event);
          break;
        case 'AGENT_MESSAGE':
          currentOptions.onAgentMessage?.(event);
          break;
        case 'AGENT_TOKEN':
          currentOptions.onAgentToken?.(event);
          break;
        case 'TOOL_CALL':
          currentOptions.onToolCall?.(event);
          break;
        case 'TOOL_RESULT':
          currentOptions.onToolResult?.(event);
          break;
        case 'LOCAL_SYSTEM_MESSAGE':
          currentOptions.onSystemMessage?.(event);
          break;
        case 'AGENT_STATE_CHANGE':
          if (event.data && typeof event.data === 'object') {
            const data = event.data as { agentId: string; from: string; to: string };
            if (data.agentId && data.from !== undefined && data.to !== undefined) {
              currentOptions.onAgentStateChange?.(data.agentId, data.from, data.to);
            }
          }
          break;
        case 'TOOL_APPROVAL_REQUEST':
          {
            const approvalData = event.data as { toolCallId: string };
            currentOptions.onApprovalRequest?.({
              toolCallId: approvalData.toolCallId,
              requestedAt: event.timestamp || new Date(),
              agentId: event.context?.threadId || 'unknown',
            } as SessionPendingApproval);
          }
          break;
        case 'TOOL_APPROVAL_RESPONSE':
          {
            const responseData = event.data as { toolCallId: string };
            currentOptions.onApprovalResponse?.(responseData.toolCallId);
          }
          break;
        case 'COMPACTION_START':
          currentOptions.onCompactionStart?.(event);
          break;
        case 'COMPACTION_COMPLETE':
          currentOptions.onCompactionComplete?.(event);
          break;
        case 'EVENT_UPDATED':
          currentOptions.onEventUpdated?.(event);
          break;
        case 'AGENT_ERROR':
          currentOptions.onAgentError?.(event);
          if (currentOptions.treatAgentErrorAsGeneric !== false) {
            if (isAgentErrorData(event.data)) {
              currentOptions.onError?.(new Error(event.data.message || 'Unknown agent error'));
            } else {
              currentOptions.onError?.(new Error('Malformed agent error event'));
            }
          }
          break;
        case 'SESSION_INFO':
          currentOptions.onSessionInfo?.(event);
          break;
        case 'AGENT_SPAWNED':
          {
            const agentEvent = event.data as AgentEvent;
            currentOptions.onAgentSpawned?.(agentEvent);
            currentOptions.onAgentEvent?.(agentEvent);
          }
          break;
      }
    };

    // Handle ProtocolEvent (new) callback
    const handleProtocolEvent = (event: ProtocolEvent, currentOptions: UseEventStreamOptions) => {
      const { update, agentSessionId } = event;

      switch (update.type) {
        case 'text_delta':
          currentOptions.onProtocolTextDelta?.({
            text: (update as { text?: string }).text || '',
            agentSessionId,
            streamSeq: update.streamSeq,
          });
          break;
        case 'thinking':
          currentOptions.onProtocolThinking?.({
            text: (update as { text?: string }).text || '',
            agentSessionId,
          });
          break;
        case 'tool_use':
          {
            const toolUpdate = update as {
              toolCallId?: string;
              name?: string;
              input?: unknown;
              status?: string;
              result?: unknown;
            };
            currentOptions.onProtocolToolUse?.({
              toolCallId: toolUpdate.toolCallId || '',
              name: toolUpdate.name || '',
              input: toolUpdate.input,
              status: toolUpdate.status || '',
              result: toolUpdate.result,
            });
          }
          break;
        case 'turn_start':
          currentOptions.onProtocolTurnStart?.({
            turnId: (update as { turnId?: string }).turnId || '',
            agentSessionId,
          });
          break;
        case 'turn_end':
          currentOptions.onProtocolTurnEnd?.({
            turnId: (update as { turnId?: string }).turnId || '',
            content: (update as { content?: unknown[] }).content || [],
            agentSessionId,
          });
          break;
        case 'error':
          {
            const errorUpdate = update as {
              code?: string;
              message?: string;
              phase?: string;
            };
            currentOptions.onProtocolError?.({
              code: errorUpdate.code || 'UNKNOWN',
              message: errorUpdate.message || 'Unknown error',
              phase: errorUpdate.phase,
            });
          }
          break;
        case 'usage':
          {
            const usageUpdate = update as {
              inputTokens?: number;
              outputTokens?: number;
            };
            currentOptions.onProtocolUsage?.({
              inputTokens: usageUpdate.inputTokens || 0,
              outputTokens: usageUpdate.outputTokens || 0,
            });
          }
          break;
      }
    };

    // Handle WebEvent callback
    const handleWebEvent = (event: WebEvent, currentOptions: UseEventStreamOptions) => {
      switch (event.type) {
        case 'USER_MESSAGE_SENT':
          {
            const data = event.data as { content: string; agentSessionId: string };
            currentOptions.onWebUserMessage?.({
              content: data.content,
              agentSessionId: data.agentSessionId,
            });
          }
          break;
        case 'AGENT_STATE_CHANGE':
          {
            const data = event.data as {
              agentSessionId: string;
              previousState: string;
              newState: string;
            };
            currentOptions.onWebAgentStateChange?.({
              agentSessionId: data.agentSessionId,
              previousState: data.previousState,
              newState: data.newState,
            });
          }
          break;
      }
    };

    // Subscribe with dual callback for LaceEvent and AppEvent
    subscriptionIdRef.current = store.subscribe(
      filter,
      // Legacy LaceEvent callback
      (event: LaceEvent) => {
        const currentOptions = optionsRef.current;
        try {
          handleLaceEvent(event, currentOptions);
        } catch (error) {
          console.error('[useEventStream] Error in LaceEvent handler:', error);
        }
      },
      // New AppEvent callback
      (event: AppEvent) => {
        const currentOptions = optionsRef.current;
        try {
          // Call generic AppEvent handler
          currentOptions.onAppEvent?.(event);

          // Route to specific handlers based on event type
          if (isProtocolEvent(event)) {
            handleProtocolEvent(event, currentOptions);
          } else if (isPermissionRequestEvent(event)) {
            currentOptions.onProtocolPermissionRequest?.({
              toolCallId: event.request.toolCallId,
              tool: event.request.tool,
              resource: event.request.resource,
              options: event.request.options,
            });
          } else if (isWebEvent(event)) {
            handleWebEvent(event, currentOptions);
          }
        } catch (error) {
          console.error('[useEventStream] Error in AppEvent handler:', error);
        }
      }
    );

    return () => {
      if (subscriptionIdRef.current) {
        store.unsubscribe(subscriptionIdRef.current);
        subscriptionIdRef.current = null;
      }
    };
  }, [filter]); // Only depend on filter

  // Get real connection stats from store
  const connectionStats = useSSEStore.getState().getConnectionStats();

  const stats = useMemo(
    () => ({
      isConnected: connectionStats.isConnected,
      subscriptionCount: connectionStats.subscriptionCount,
      connectionUrl: connectionStats.connectionUrl,
      connectedAt: connectionStats.connectedAt,
    }),
    [connectionStats]
  );

  // Backward-compatible close function
  const close = useCallback(() => {
    if (subscriptionIdRef.current) {
      useSSEStore.getState().unsubscribe(subscriptionIdRef.current);
      subscriptionIdRef.current = null;
    }
  }, []);

  // Backward-compatible reconnect function
  const reconnect = useCallback(() => {
    useSSEStore.getState().reconnect();
  }, []);

  return {
    connection: {
      connected: stats.isConnected,
      reconnectAttempts: 0, // Firehose handles this internally
      maxReconnectAttempts: 5,
      lastEventId: lastEvent?.id,
    },
    lastEvent,
    close,
    reconnect,
  };
}
