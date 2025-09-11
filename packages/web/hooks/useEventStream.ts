// ABOUTME: New useEventStream hook using EventStreamFirehose singleton
// ABOUTME: Maintains same API as original but uses shared EventSource connection

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSSEStore } from '@/lib/sse-store';
import type { LaceEvent, Task, AgentErrorData } from '@/types/core';
import type { PendingApproval } from '@/types/api';

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

// Re-export types from original for compatibility
export interface TaskEvent {
  type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:note_added';
  task?: Task;
  taskId?: string;
  context: {
    actor: string;
    isHuman?: boolean;
  };
  timestamp: Date;
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

interface AgentEvent {
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
  // Session events
  onSessionEvent?: (event: LaceEvent) => void;
  onUserMessage?: (event: LaceEvent) => void;
  onAgentMessage?: (event: LaceEvent) => void;
  onAgentToken?: (event: LaceEvent) => void;
  onToolCall?: (event: LaceEvent) => void;
  onToolResult?: (event: LaceEvent) => void;
  onSystemMessage?: (event: LaceEvent) => void;
  onAgentStateChange?: (agentId: string, from: string, to: string) => void;

  // Task events
  onTaskEvent?: (event: TaskEvent) => void;
  onTaskCreated?: (event: TaskEvent) => void;
  onTaskUpdated?: (event: TaskEvent) => void;
  onTaskDeleted?: (event: TaskEvent) => void;
  onTaskNoteAdded?: (event: TaskEvent) => void;

  // Approval events
  onApprovalRequest?: (approval: PendingApproval) => void;
  onApprovalResponse?: (toolCallId: string) => void;

  // Project events
  onProjectEvent?: (event: ProjectEvent) => void;
  onProjectCreated?: (event: ProjectEvent) => void;
  onProjectUpdated?: (event: ProjectEvent) => void;
  onProjectDeleted?: (event: ProjectEvent) => void;

  // Agent events
  onAgentEvent?: (event: AgentEvent) => void;
  onAgentSpawned?: (event: AgentEvent) => void;
  onAgentStarted?: (event: AgentEvent) => void;
  onAgentStopped?: (event: AgentEvent) => void;

  // Compaction events
  onCompactionStart?: (event: LaceEvent) => void;
  onCompactionComplete?: (event: LaceEvent) => void;

  // Global events
  onGlobalEvent?: (event: GlobalEvent) => void;
  onSystemNotification?: (event: GlobalEvent) => void;

  // Error event handlers
  onAgentError?: (event: LaceEvent) => void;

  // Connection events (deprecated but kept for compatibility)
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
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
  sendCount: number;
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

    // Pass current options directly to avoid stale closure - handlers are resolved at call-time
    subscriptionIdRef.current = store.subscribe(filter, (event) => {
      // Get fresh handlers at the moment the event arrives
      const currentOptions = optionsRef.current;

      try {
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
          case 'TASK_CREATED':
            {
              const taskEvent = event.data as TaskEvent;
              currentOptions.onTaskEvent?.(taskEvent);
              currentOptions.onTaskCreated?.(taskEvent);
            }
            break;
          case 'TASK_UPDATED':
            {
              const taskEvent = event.data as TaskEvent;
              currentOptions.onTaskEvent?.(taskEvent);
              currentOptions.onTaskUpdated?.(taskEvent);
            }
            break;
          case 'TASK_DELETED':
            {
              const taskEvent = event.data as TaskEvent;
              currentOptions.onTaskEvent?.(taskEvent);
              currentOptions.onTaskDeleted?.(taskEvent);
            }
            break;
          case 'TASK_NOTE_ADDED':
            {
              const taskEvent = event.data as TaskEvent;
              currentOptions.onTaskEvent?.(taskEvent);
              currentOptions.onTaskNoteAdded?.(taskEvent);
            }
            break;
          case 'TOOL_APPROVAL_REQUEST':
            {
              const approvalData = event.data as { toolCallId: string };
              currentOptions.onApprovalRequest?.({
                toolCallId: approvalData.toolCallId,
                requestedAt: event.timestamp || new Date(),
              } as PendingApproval);
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
          // Add error event handling
          case 'AGENT_ERROR':
            currentOptions.onAgentError?.(event);
            // Only call onError if treatAgentErrorAsGeneric is not disabled
            if (currentOptions.treatAgentErrorAsGeneric !== false) {
              if (isAgentErrorData(event.data)) {
                currentOptions.onError?.(new Error(event.data.message || 'Unknown agent error'));
              } else {
                currentOptions.onError?.(new Error('Malformed agent error event'));
              }
            }
            break;
          // Add other event type cases as needed
        }
      } catch (error) {
        console.error('[useEventStream] Error in event handler:', error);
      }
    });

    return () => {
      if (subscriptionIdRef.current) {
        store.unsubscribe(subscriptionIdRef.current);
        subscriptionIdRef.current = null;
      }
    };
  }, [filter]); // Only depend on filter

  // Get current stats from Zustand store - connection status only
  const connectionStatus = useSSEStore((state) => state.connectionStatus);
  const eventSource = useSSEStore((state) => state.eventSource);
  const connectedAt = useSSEStore((state) => state.lastConnectedAt);

  const stats = useMemo(
    () => ({
      isConnected: connectionStatus === 'connected',
      subscriptionCount: 1, // Simplified for compatibility
      eventsReceived: 0, // Components track their own events
      connectionUrl: eventSource?.url || null,
      connectedAt,
    }),
    [connectionStatus, eventSource, connectedAt]
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
    sendCount: stats.eventsReceived,
    close,
    reconnect,
  };
}
