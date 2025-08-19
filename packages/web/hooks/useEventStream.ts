// ABOUTME: Unified event stream hook for all real-time events
// ABOUTME: Single EventSource connection handling session, task, project, and approval events

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { StreamSubscription, StreamConnection } from '@/types/stream-events';
import type { LaceEvent } from '@/types/core';
import { parseTyped } from '@/lib/serialization';
import type { ThreadId } from '@/types/core';
import type { PendingApproval } from '@/types/api';
import type { Task } from '@/types/core';

// Task event types
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

// Project event types
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

// Agent event types
interface AgentEvent {
  type: 'agent:spawned' | 'agent:started' | 'agent:stopped';
  taskId?: string;
  agentThreadId: ThreadId;
  providerInstanceId: string;
  modelId: string;
  context: {
    actor: string;
    isHuman: boolean;
  };
  timestamp: Date;
}

// Global event types
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

  // Connection events and error handling
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

interface UseEventStreamOptions extends EventHandlers {
  projectId?: string;
  sessionId?: string;
  threadIds?: string[];
  includeGlobal?: boolean;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export interface UseEventStreamResult {
  connection: StreamConnection;
  lastEvent?: LaceEvent;
  sendCount: number;
  close: () => void;
  reconnect: () => void;
}

function isTaskEvent(event: LaceEvent): boolean {
  // Check if it's a task event by looking at the type
  // Task events come through as TASK_CREATED, TASK_UPDATED, etc. (will be added to enum)
  return (
    event.type &&
    ['TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'TASK_NOTE_ADDED'].includes(
      event.type as string
    )
  );
}

function isAgentEvent(event: LaceEvent): boolean {
  // Agent events include AGENT_SPAWNED and AGENT_STATE_CHANGE
  return event.type && ['AGENT_SPAWNED', 'AGENT_STATE_CHANGE'].includes(event.type as string);
}

function isProjectEvent(event: LaceEvent): boolean {
  // Project events will be added to LaceEventType enum
  return (
    event.type &&
    ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED'].includes(event.type as string)
  );
}

function isGlobalEvent(event: LaceEvent): boolean {
  // Global/system events
  return (
    event.type && ['SYSTEM_NOTIFICATION', 'LOCAL_SYSTEM_MESSAGE'].includes(event.type as string)
  );
}

function isSessionEvent(event: LaceEvent): boolean {
  // Session events are the core LaceEvent types
  return (
    event.type &&
    [
      'USER_MESSAGE',
      'AGENT_MESSAGE',
      'AGENT_TOKEN',
      'TOOL_CALL',
      'TOOL_RESULT',
      'TOOL_APPROVAL_REQUEST',
      'TOOL_APPROVAL_RESPONSE',
      'LOCAL_SYSTEM_MESSAGE',
      'AGENT_STATE_CHANGE',
      'COMPACTION_START',
      'COMPACTION_COMPLETE',
    ].includes(event.type)
  );
}

export function useEventStream({
  projectId,
  sessionId,
  threadIds,
  includeGlobal = false,
  autoReconnect = true,
  reconnectInterval = 1000,
  onConnect,
  onDisconnect,
  onError,
  // Session event handlers
  onSessionEvent,
  onUserMessage,
  onAgentMessage,
  onAgentToken,
  onToolCall,
  onToolResult,
  onSystemMessage,
  onAgentStateChange,
  // Task event handlers
  onTaskEvent,
  onTaskCreated,
  onTaskUpdated,
  onTaskDeleted,
  onTaskNoteAdded,
  // Approval handlers
  onApprovalRequest,
  onApprovalResponse,
  // Project event handlers
  onProjectEvent,
  onProjectCreated,
  onProjectUpdated,
  onProjectDeleted,
  // Agent event handlers
  onAgentEvent,
  onAgentSpawned,
  onAgentStarted,
  onAgentStopped,
  // Global event handlers
  onGlobalEvent,
  onSystemNotification,
}: UseEventStreamOptions): UseEventStreamResult {
  const [connection, setConnection] = useState<StreamConnection>({
    connected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
  });

  const [lastEvent, setLastEvent] = useState<LaceEvent>();
  const [sendCount, setSendCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleStreamEventRef = useRef<(event: LaceEvent) => void>(() => {});
  const autoReconnectRef = useRef(autoReconnect);
  const reconnectIntervalRef = useRef(reconnectInterval);
  const includeGlobalRef = useRef(includeGlobal);

  // Store callbacks in refs to avoid recreating connect on every callback change
  const callbackRefs = useRef({
    onConnect,
    onDisconnect,
    onError,
    onSessionEvent,
    onUserMessage,
    onAgentMessage,
    onAgentToken,
    onToolCall,
    onToolResult,
    onSystemMessage,
    onAgentStateChange,
    onTaskEvent,
    onTaskCreated,
    onTaskUpdated,
    onTaskDeleted,
    onTaskNoteAdded,
    onApprovalRequest,
    onApprovalResponse,
    onProjectEvent,
    onProjectCreated,
    onProjectUpdated,
    onProjectDeleted,
    onAgentEvent,
    onAgentSpawned,
    onAgentStarted,
    onAgentStopped,
    onGlobalEvent,
    onSystemNotification,
  });

  // Update callback refs when callbacks change
  useEffect(() => {
    callbackRefs.current = {
      onConnect,
      onDisconnect,
      onError,
      onSessionEvent,
      onUserMessage,
      onAgentMessage,
      onAgentToken,
      onToolCall,
      onToolResult,
      onSystemMessage,
      onAgentStateChange,
      onTaskEvent,
      onTaskCreated,
      onTaskUpdated,
      onTaskDeleted,
      onTaskNoteAdded,
      onApprovalRequest,
      onApprovalResponse,
      onProjectEvent,
      onProjectCreated,
      onProjectUpdated,
      onProjectDeleted,
      onAgentEvent,
      onAgentSpawned,
      onAgentStarted,
      onAgentStopped,
      onGlobalEvent,
      onSystemNotification,
    };

    // Update reconnection settings refs
    autoReconnectRef.current = autoReconnect;
    reconnectIntervalRef.current = reconnectInterval;
    includeGlobalRef.current = includeGlobal;
  }, [
    onConnect,
    onDisconnect,
    onError,
    onSessionEvent,
    onUserMessage,
    onAgentMessage,
    onAgentToken,
    onToolCall,
    onToolResult,
    onSystemMessage,
    onAgentStateChange,
    onTaskEvent,
    onTaskCreated,
    onTaskUpdated,
    onTaskDeleted,
    onTaskNoteAdded,
    onApprovalRequest,
    onApprovalResponse,
    onProjectEvent,
    onProjectCreated,
    onProjectUpdated,
    onProjectDeleted,
    onAgentEvent,
    onAgentSpawned,
    onAgentStarted,
    onAgentStopped,
    onGlobalEvent,
    onSystemNotification,
    autoReconnect,
    reconnectInterval,
    includeGlobal,
  ]);

  // Create unified subscription for ALL event types
  // Use JSON.stringify to create a stable reference that only changes when content changes
  const subscriptionKey = useMemo(
    () => {
      // Sort arrays to ensure consistent key even if order changes
      const sortedThreadIds = threadIds ? [...threadIds].sort() : [];
      return JSON.stringify({
        projectIds: projectId ? [projectId] : [],
        sessionIds: sessionId ? [sessionId] : [],
        threads: sortedThreadIds,
        includeGlobal,
      });
    },
    [projectId, sessionId, threadIds?.join(','), includeGlobal] // Use join for array stability
  );

  const subscription = useMemo(
    () => ({
      projectIds: projectId ? [projectId] : [],
      sessionIds: sessionId ? [sessionId] : [],
      threads: threadIds || [],
    }),
    [subscriptionKey] // Only recreate when actual content changes
  );

  // Build query string from subscription - pure function, no need for useCallback
  const buildQueryString = (sub: StreamSubscription, includeGlobal: boolean): string => {
    const params = new URLSearchParams();

    if (sub.projectIds?.length) params.set('projects', sub.projectIds.join(','));
    if (sub.sessionIds?.length) params.set('sessions', sub.sessionIds.join(','));
    if (sub.threads?.length) params.set('threads', sub.threads.join(','));
    if (includeGlobal) params.set('global', 'true');

    return params.toString();
  };

  // Unified event handler that routes to specific callbacks
  const handleStreamEvent = useCallback((event: LaceEvent) => {
    try {
      console.log('[EVENT_STREAM_CLIENT] Routing event:', {
        id: event.id,
        type: event.type,
        threadId: event.threadId,
        isSessionEvent: isSessionEvent(event),
        isTaskEvent: isTaskEvent(event),
        isAgentEvent: isAgentEvent(event),
        isProjectEvent: isProjectEvent(event),
        isGlobalEvent: isGlobalEvent(event),
      });

      if (isSessionEvent(event)) {
        // Handle tool approval requests
        if (event.type === 'TOOL_APPROVAL_REQUEST') {
          const approvalData = event.data as { toolCallId: string };

          // Pass minimal data - consumer will fetch full details or look up TOOL_CALL event
          callbackRefs.current.onApprovalRequest?.({
            toolCallId: approvalData.toolCallId,
            requestedAt: event.timestamp || new Date(),
          } as PendingApproval);
          return; // Don't process as regular session event
        }

        // Handle tool approval responses
        if (event.type === 'TOOL_APPROVAL_RESPONSE') {
          const responseData = event.data as { toolCallId: string };
          callbackRefs.current.onApprovalResponse?.(responseData.toolCallId);
          return; // Don't process as regular session event
        }

        // Route to specific session event handlers
        callbackRefs.current.onSessionEvent?.(event);
        switch (event.type) {
          case 'USER_MESSAGE':
            callbackRefs.current.onUserMessage?.(event);
            break;
          case 'AGENT_MESSAGE':
            callbackRefs.current.onAgentMessage?.(event);
            break;
          case 'AGENT_TOKEN':
            callbackRefs.current.onAgentToken?.(event);
            break;
          case 'TOOL_CALL':
            callbackRefs.current.onToolCall?.(event);
            break;
          case 'TOOL_RESULT':
            callbackRefs.current.onToolResult?.(event);
            break;
          case 'LOCAL_SYSTEM_MESSAGE':
            callbackRefs.current.onSystemMessage?.(event);
            break;
          case 'AGENT_STATE_CHANGE': {
            if (event.data && typeof event.data === 'object') {
              const data = event.data as { agentId: string; from: string; to: string };
              if (data.agentId && data.from !== undefined && data.to !== undefined) {
                callbackRefs.current.onAgentStateChange?.(data.agentId, data.from, data.to);
              }
            }
            break;
          }
        }
      } else if (isTaskEvent(event)) {
        // Extract task event data from LaceEvent
        const taskEvent = event.data as TaskEvent;
        callbackRefs.current.onTaskEvent?.(taskEvent);
        switch (taskEvent.type) {
          case 'task:created':
            callbackRefs.current.onTaskCreated?.(taskEvent);
            break;
          case 'task:updated':
            callbackRefs.current.onTaskUpdated?.(taskEvent);
            break;
          case 'task:deleted':
            callbackRefs.current.onTaskDeleted?.(taskEvent);
            break;
          case 'task:note_added':
            callbackRefs.current.onTaskNoteAdded?.(taskEvent);
            break;
        }
      } else if (isAgentEvent(event)) {
        // Extract agent event data from LaceEvent
        const agentEvent = event.data as unknown as AgentEvent;
        callbackRefs.current.onAgentEvent?.(agentEvent);
        switch (agentEvent.type) {
          case 'agent:spawned':
            callbackRefs.current.onAgentSpawned?.(agentEvent);
            break;
          case 'agent:started':
            callbackRefs.current.onAgentStarted?.(agentEvent);
            break;
          case 'agent:stopped':
            callbackRefs.current.onAgentStopped?.(agentEvent);
            break;
        }
      } else if (isProjectEvent(event)) {
        // Extract project event data from LaceEvent
        const projectEvent = event.data as ProjectEvent;
        callbackRefs.current.onProjectEvent?.(projectEvent);
        switch (projectEvent.type) {
          case 'project:created':
            callbackRefs.current.onProjectCreated?.(projectEvent);
            break;
          case 'project:updated':
            callbackRefs.current.onProjectUpdated?.(projectEvent);
            break;
          case 'project:deleted':
            callbackRefs.current.onProjectDeleted?.(projectEvent);
            break;
        }
      } else if (isGlobalEvent(event)) {
        // Extract global event data from LaceEvent
        const globalEvent = event.data as GlobalEvent;
        callbackRefs.current.onGlobalEvent?.(globalEvent);
        if (globalEvent.type === 'system:notification') {
          callbackRefs.current.onSystemNotification?.(globalEvent);
        }
      }
    } catch (error) {
      console.error('[EVENT_STREAM] Failed to parse stream event:', error, event);
      callbackRefs.current.onError?.(error as Error);
    }
  }, []);

  // Update handleStreamEvent ref when it changes
  useEffect(() => {
    handleStreamEventRef.current = handleStreamEvent;
  }, [handleStreamEvent]);

  // Store subscription in ref to access current value without recreating connect
  const subscriptionRef = useRef(subscription);
  useEffect(() => {
    subscriptionRef.current = subscription;
  }, [subscription]);

  // Track if we're intentionally closing to prevent reconnect storms
  const isClosingRef = useRef(false);

  // Connect to stream - no dependencies, uses refs for current values
  const connect = useCallback(() => {
    // Don't connect if we're in the process of closing
    if (isClosingRef.current) {
      return;
    }

    // Always close any existing connection first
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const queryString = buildQueryString(subscriptionRef.current, includeGlobalRef.current);
    const url = `/api/events/stream${queryString ? `?${queryString}` : ''}`;

    console.log('[EVENT_STREAM_CLIENT] Connecting to:', {
      url: url,
      subscription: subscriptionRef.current,
      includeGlobal: includeGlobalRef.current,
    });

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[EVENT_STREAM_CLIENT] Connected to:', url);
      setConnection((prev) => ({
        ...prev,
        connected: true,
        reconnectAttempts: 0,
      }));
      callbackRefs.current.onConnect?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const threadEvent = parseTyped<LaceEvent>(event.data);

        console.log('[EVENT_STREAM_CLIENT] Received event:', {
          id: threadEvent.id,
          type: threadEvent.type,
          threadId: threadEvent.threadId,
          timestamp: threadEvent.timestamp,
          dataSize:
            typeof threadEvent.data === 'string'
              ? threadEvent.data.length
              : JSON.stringify(threadEvent.data).length,
          context: threadEvent.context,
        });

        setLastEvent(threadEvent);
        setSendCount((prev) => prev + 1);
        setConnection((prev) => ({
          ...prev,
          lastEventId: threadEvent.id,
        }));

        handleStreamEventRef.current?.(threadEvent);
      } catch (error) {
        console.error(
          '[EVENT_STREAM_CLIENT] Failed to parse event:',
          error,
          'Raw data:',
          event.data
        );
        callbackRefs.current.onError?.(error as Error);
      }
    };

    eventSource.onerror = (error) => {
      // Check if this is a normal close or an actual error
      if (eventSource.readyState !== EventSource.CLOSED) {
        console.warn('[EVENT_STREAM_CLIENT] Connection interrupted, attempting reconnect...', {
          readyState: eventSource.readyState,
          url: url,
          error: error,
        });
      } else {
        console.log('[EVENT_STREAM_CLIENT] Connection closed normally');
      }

      setConnection((prev) => {
        const newState = {
          ...prev,
          connected: false,
          reconnectAttempts: prev.reconnectAttempts + 1,
        };

        callbackRefs.current.onDisconnect?.();

        // Only treat as error if not intentionally closed and not auto-reconnecting
        if (eventSource.readyState !== EventSource.CLOSED && !autoReconnectRef.current) {
          // Schedule error callback to avoid state update issues
          setTimeout(() => {
            callbackRefs.current.onError?.(new Error('SSE connection failed'));
          }, 0);
        }

        // Auto-reconnect logic using ref values to avoid stale closures
        if (
          autoReconnectRef.current &&
          newState.reconnectAttempts < newState.maxReconnectAttempts &&
          !isClosingRef.current // Don't reconnect if we're closing
        ) {
          reconnectTimeoutRef.current = setTimeout(
            () => {
              // Use a fresh connect call to avoid stale closures
              if (
                eventSourceRef.current?.readyState !== EventSource.CONNECTING &&
                !isClosingRef.current
              ) {
                connect();
              }
            },
            reconnectIntervalRef.current * Math.pow(2, newState.reconnectAttempts - 1)
          ); // Exponential backoff
        }

        return newState;
      });
    };
  }, []); // No dependencies - connect is now stable

  // Manual reconnect
  const reconnect = useCallback(() => {
    setConnection((prev) => ({ ...prev, reconnectAttempts: 0 }));
    connect();
  }, [connect]);

  // Close connection
  const close = useCallback(() => {
    isClosingRef.current = true;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnection((prev) => ({ ...prev, connected: false }));

    // Reset closing flag after a small delay
    setTimeout(() => {
      isClosingRef.current = false;
    }, 100);
  }, []);

  // Track previous subscription to detect actual changes
  const prevSubscriptionKeyRef = useRef<string | undefined>(undefined);

  // Connect on mount, reconnect only when subscription actually changes
  useEffect(() => {
    const currentKey = subscriptionKey;

    // Always connect on mount (when prevKey is undefined) or when subscription changed
    if (prevSubscriptionKeyRef.current !== currentKey) {
      prevSubscriptionKeyRef.current = currentKey;
      connect();
    } else {
      // If we have a subscription but no connection, reconnect
      if (currentKey && !connection.connected) {
        connect();
      }
    }

    return () => {
      isClosingRef.current = true;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Reset closing flag
      isClosingRef.current = false;
    };
  }, [subscriptionKey, connect]);

  return {
    connection,
    lastEvent,
    sendCount,
    close,
    reconnect,
  };
}
