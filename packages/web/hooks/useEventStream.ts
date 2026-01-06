// ABOUTME: Event stream hook using SSE store singleton
// ABOUTME: Uses AppEvent (ProtocolEvent | PermissionRequestEvent | WebEvent)

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSSEStore } from '@lace/web/lib/sse-store';
import type { SessionPendingApproval } from '@lace/web/types/api';
import type { AppEvent } from '@lace/web/types/app-events';
import type { ProtocolEvent } from '@lace/web/types/protocol-events';
import type { WebEvent } from '@lace/web/types/web-events';
import { isProtocolEvent, isPermissionRequestEvent, isWebEvent } from '@lace/web/types/app-events';

// Runtime type guard for error data in protocol events
interface AgentErrorDataShape {
  errorType: string;
  message: string;
  context: Record<string, unknown>;
  isRetryable: boolean;
}

function _isAgentErrorData(value: unknown): value is AgentErrorDataShape {
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

// Matches WebEvent AgentSpawnedEvent.data shape
export interface AgentEvent {
  agentSessionId: string;
  parentSessionId?: string;
  taskId?: string;
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
  // Session events
  onSessionEvent?: (event: AppEvent) => void;
  onUserMessage?: (event: AppEvent) => void;
  onAgentMessage?: (event: AppEvent) => void;
  onAgentToken?: (event: AppEvent) => void;
  onToolCall?: (event: AppEvent) => void;
  onToolResult?: (event: AppEvent) => void;
  onSystemMessage?: (event: AppEvent) => void;
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
  onSessionInfo?: (event: AppEvent) => void;

  // Agent events
  onAgentEvent?: (event: AgentEvent) => void;
  onAgentSpawned?: (event: AgentEvent) => void;
  onAgentStarted?: (event: AgentEvent) => void;
  onAgentStopped?: (event: AgentEvent) => void;

  // Compaction events (ProtocolEvent with compaction_start/complete)
  onCompactionStart?: (event: AppEvent) => void;
  onCompactionComplete?: (event: AppEvent) => void;
  onEventUpdated?: (event: AppEvent) => void;

  // Global events
  onGlobalEvent?: (event: GlobalEvent) => void;
  onSystemNotification?: (event: GlobalEvent) => void;

  // Error event handlers
  onAgentError?: (event: AppEvent) => void;

  // Connection events
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: unknown) => void;

  // Protocol event handlers (AppEvent system)
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

  // Web event handlers
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
  lastEvent?: AppEvent;
  close: () => void;
  reconnect: () => void;
}

export function useEventStream(options: UseEventStreamOptions): UseEventStreamResult {
  const [lastEvent, setLastEvent] = useState<AppEvent>();
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

    // Handle ProtocolEvent callback
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
        case 'USER_MESSAGE':
          {
            currentOptions.onWebUserMessage?.({
              content: typeof event.data === 'string' ? event.data : '',
              agentSessionId: event.agentSessionId || 'unknown',
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

    subscriptionIdRef.current = store.subscribe(filter, (event: AppEvent) => {
      const currentOptions = optionsRef.current;
      try {
        setLastEvent(event);

        // Call generic AppEvent handler
        currentOptions.onAppEvent?.(event);

        // Also call legacy onSessionEvent handler for compatibility
        currentOptions.onSessionEvent?.(event);

        // Route to specific handlers based on event type
        if (isProtocolEvent(event)) {
          handleProtocolEvent(event, currentOptions);

          // Route protocol events to legacy-named handlers where applicable
          switch (event.update.type) {
            case 'text_delta':
              currentOptions.onAgentToken?.(event);
              break;
            case 'tool_use':
              {
                const toolUpdate = event.update as { status?: string };
                if (toolUpdate.status === 'pending') {
                  currentOptions.onToolCall?.(event);
                } else {
                  currentOptions.onToolResult?.(event);
                }
              }
              break;
            case 'compaction_start':
              currentOptions.onCompactionStart?.(event);
              break;
            case 'compaction_complete':
              currentOptions.onCompactionComplete?.(event);
              break;
            case 'error':
              currentOptions.onAgentError?.(event);
              if (currentOptions.treatAgentErrorAsGeneric !== false) {
                const errorUpdate = event.update as { message?: string };
                currentOptions.onError?.(new Error(errorUpdate.message || 'Unknown agent error'));
              }
              break;
            case 'session_info':
              currentOptions.onSessionInfo?.(event);
              break;
          }
        } else if (isPermissionRequestEvent(event)) {
          currentOptions.onProtocolPermissionRequest?.({
            toolCallId: event.request.toolCallId,
            tool: event.request.tool,
            resource: event.request.resource,
            options: event.request.options,
          });
          currentOptions.onApprovalRequest?.({
            toolCallId: event.request.toolCallId,
            requestedAt: event.timestamp,
            agentId: event.request.sessionId || 'unknown',
          } as SessionPendingApproval);
        } else if (isWebEvent(event)) {
          handleWebEvent(event, currentOptions);

          // Route web events to legacy-named handlers
          switch (event.type) {
            case 'USER_MESSAGE':
              currentOptions.onUserMessage?.(event);
              break;
            case 'LOCAL_SYSTEM_MESSAGE':
              currentOptions.onSystemMessage?.(event);
              break;
            case 'AGENT_STATE_CHANGE':
              {
                const data = event.data as {
                  agentSessionId: string;
                  previousState: string;
                  newState: string;
                };
                currentOptions.onAgentStateChange?.(
                  data.agentSessionId,
                  data.previousState,
                  data.newState
                );
              }
              break;
            case 'EVENT_UPDATED':
              currentOptions.onEventUpdated?.(event);
              break;
            case 'TOOL_APPROVAL_RESPONSE':
              {
                const data = event.data as { requestId: string };
                currentOptions.onApprovalResponse?.(data.requestId);
              }
              break;
            case 'AGENT_SPAWNED':
              {
                const data = event.data as {
                  agentSessionId: string;
                  parentSessionId?: string;
                  taskId?: string;
                };
                currentOptions.onAgentSpawned?.(data);
                currentOptions.onAgentEvent?.(data);
              }
              break;
          }
        }
      } catch (error) {
        console.error('[useEventStream] Error in AppEvent handler:', error);
      }
    });

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
