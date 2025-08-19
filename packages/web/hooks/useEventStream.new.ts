// ABOUTME: New useEventStream hook using EventStreamFirehose singleton
// ABOUTME: Maintains same API as original but uses shared EventSource connection

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EventStreamFirehose } from '@/lib/event-stream-firehose';
import type { LaceEvent } from '@/types/core';
import type { PendingApproval } from '@/types/api';

// Re-export types from original for compatibility
export interface TaskEvent {
  type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:note_added';
  task?: any;
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

  // Global events
  onGlobalEvent?: (event: GlobalEvent) => void;
  onSystemNotification?: (event: GlobalEvent) => void;

  // Connection events (deprecated but kept for compatibility)
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

interface UseEventStreamOptions extends EventHandlers {
  projectId?: string;
  sessionId?: string;
  threadIds?: string[];
  includeGlobal?: boolean;

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

  // Build filter from options (memoized for performance)
  const filter = useMemo(
    () => ({
      projectIds: options.projectId ? [options.projectId] : undefined,
      sessionIds: options.sessionId ? [options.sessionId] : undefined,
      threadIds: options.threadIds,
      eventTypes: undefined, // Could be added later
    }),
    [
      options.projectId,
      options.sessionId,
      options.threadIds?.join(','), // Stable array comparison
    ]
  );

  // Event router that dispatches to specific handlers
  const handleEvent = useCallback(
    (event: LaceEvent) => {
      setLastEvent(event);

      // Call general handler first
      options.onSessionEvent?.(event);

      // Route to specific handlers based on event type
      switch (event.type) {
        case 'USER_MESSAGE':
          options.onUserMessage?.(event);
          break;
        case 'AGENT_MESSAGE':
          options.onAgentMessage?.(event);
          break;
        case 'AGENT_TOKEN':
          options.onAgentToken?.(event);
          break;
        case 'TOOL_CALL':
          options.onToolCall?.(event);
          break;
        case 'TOOL_RESULT':
          options.onToolResult?.(event);
          break;
        case 'LOCAL_SYSTEM_MESSAGE':
          options.onSystemMessage?.(event);
          break;
        case 'AGENT_STATE_CHANGE':
          if (event.data && typeof event.data === 'object') {
            const data = event.data as { agentId: string; from: string; to: string };
            options.onAgentStateChange?.(data.agentId, data.from, data.to);
          }
          break;
        case 'TASK_CREATED':
          {
            const taskEvent = event.data as TaskEvent;
            options.onTaskEvent?.(taskEvent);
            options.onTaskCreated?.(taskEvent);
          }
          break;
        case 'TASK_UPDATED':
          {
            const taskEvent = event.data as TaskEvent;
            options.onTaskEvent?.(taskEvent);
            options.onTaskUpdated?.(taskEvent);
          }
          break;
        case 'TASK_DELETED':
          {
            const taskEvent = event.data as TaskEvent;
            options.onTaskEvent?.(taskEvent);
            options.onTaskDeleted?.(taskEvent);
          }
          break;
        case 'TASK_NOTE_ADDED':
          {
            const taskEvent = event.data as TaskEvent;
            options.onTaskEvent?.(taskEvent);
            options.onTaskNoteAdded?.(taskEvent);
          }
          break;
        case 'TOOL_APPROVAL_REQUEST':
          {
            const approvalData = event.data as { toolCallId: string };
            options.onApprovalRequest?.({
              toolCallId: approvalData.toolCallId,
              requestedAt: event.timestamp || new Date(),
            } as PendingApproval);
          }
          break;
        case 'TOOL_APPROVAL_RESPONSE':
          {
            const responseData = event.data as { toolCallId: string };
            options.onApprovalResponse?.(responseData.toolCallId);
          }
          break;
        // Add other event type cases as needed
      }
    },
    [options]
  );

  // Subscribe/unsubscribe effect
  useEffect(() => {
    const firehose = EventStreamFirehose.getInstance();

    subscriptionIdRef.current = firehose.subscribe(filter, handleEvent);

    return () => {
      if (subscriptionIdRef.current) {
        firehose.unsubscribe(subscriptionIdRef.current);
        subscriptionIdRef.current = null;
      }
    };
  }, [filter, handleEvent]);

  // Get current stats from firehose
  const stats = EventStreamFirehose.getInstance().getStats();

  // Backward-compatible close function (no-op for firehose)
  const close = useCallback(() => {
    if (subscriptionIdRef.current) {
      EventStreamFirehose.getInstance().unsubscribe(subscriptionIdRef.current);
      subscriptionIdRef.current = null;
    }
  }, []);

  // Backward-compatible reconnect function (no-op for firehose)
  const reconnect = useCallback(() => {
    // Firehose handles reconnection automatically
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
