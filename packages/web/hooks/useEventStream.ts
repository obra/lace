// ABOUTME: Unified event stream hook for all real-time events
// ABOUTME: Single EventSource connection handling session, task, project, and approval events

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { StreamEvent, StreamSubscription, StreamConnection } from '@/types/stream-events';
import type { SessionEvent, ThreadId, ToolApprovalRequestData } from '@/types/api';
import type { Task } from '@/lib/core';
import {
  parseSessionEvent,
  StreamEventTimestampSchema,
} from '@/lib/validation/session-event-schemas';

// Task event types
export interface TaskEvent {
  type: 'task:created' | 'task:updated' | 'task:deleted' | 'task:note_added';
  task?: Task;
  taskId?: string;
  context: {
    actor: string;
    isHuman?: boolean;
  };
  timestamp: string;
}

// Approval event types
interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
}

// Project event types
export interface ProjectEvent {
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
  timestamp: string;
}

// Agent event types
export interface AgentEvent {
  type: 'agent:spawned' | 'agent:started' | 'agent:stopped';
  taskId?: string;
  agentThreadId: ThreadId;
  provider: string;
  model: string;
  context: {
    actor: string;
    isHuman: boolean;
  };
  timestamp: string;
}

// Global event types
export interface GlobalEvent {
  type: 'system:maintenance' | 'system:update' | 'system:notification';
  message: string;
  severity: 'info' | 'warning' | 'error';
  context: {
    actor: string;
    isHuman: boolean;
  };
  timestamp: string;
}

interface EventHandlers {
  // Session events
  onSessionEvent?: (event: SessionEvent) => void;
  onUserMessage?: (event: SessionEvent) => void;
  onAgentMessage?: (event: SessionEvent) => void;
  onAgentToken?: (event: SessionEvent) => void;
  onToolCall?: (event: SessionEvent) => void;
  onToolResult?: (event: SessionEvent) => void;
  onSystemMessage?: (event: SessionEvent) => void;

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

interface UseEventStreamResult {
  connection: StreamConnection;
  lastEvent?: StreamEvent;
  sendCount: number;
  close: () => void;
  reconnect: () => void;
}

function isTaskEvent(streamEvent: StreamEvent): boolean {
  return (
    streamEvent.eventType === 'task' &&
    ['task:created', 'task:updated', 'task:deleted', 'task:note_added'].includes(
      (streamEvent.data as TaskEvent).type
    )
  );
}

function isAgentEvent(streamEvent: StreamEvent): boolean {
  return (
    streamEvent.eventType === 'task' &&
    ['agent:spawned', 'agent:started', 'agent:stopped'].includes(
      (streamEvent.data as AgentEvent).type
    )
  );
}

function isProjectEvent(streamEvent: StreamEvent): boolean {
  return streamEvent.eventType === 'project';
}

function isGlobalEvent(streamEvent: StreamEvent): boolean {
  return streamEvent.eventType === 'global';
}

function isSessionEvent(streamEvent: StreamEvent): boolean {
  return streamEvent.eventType === 'session';
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

  const [lastEvent, setLastEvent] = useState<StreamEvent>();
  const [sendCount, setSendCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  ]);

  // Create unified subscription for ALL event types
  const subscription = useMemo(
    () => ({
      projects: projectId ? [projectId] : [],
      sessions: sessionId ? [sessionId] : [],
      threads: threadIds || [],
      global: includeGlobal,
      eventTypes: ['session', 'task', 'project', 'global'] as const,
    }),
    [projectId, sessionId, threadIds, includeGlobal]
  );

  // Build query string from subscription
  const buildQueryString = useCallback((sub: StreamSubscription): string => {
    const params = new URLSearchParams();

    if (sub.projects?.length) params.set('projects', sub.projects.join(','));
    if (sub.sessions?.length) params.set('sessions', sub.sessions.join(','));
    if (sub.threads?.length) params.set('threads', sub.threads.join(','));
    if (sub.global) params.set('global', 'true');
    if (sub.eventTypes?.length) params.set('eventTypes', sub.eventTypes.join(','));

    return params.toString();
  }, []);

  // Unified event handler that routes to specific callbacks
  const handleStreamEvent = useCallback((streamEvent: StreamEvent) => {
    try {
      if (isSessionEvent(streamEvent)) {
        // Parse and validate SessionEvent with proper date hydration
        const sessionEvent = parseSessionEvent(streamEvent.data);
        const streamTimestamp = StreamEventTimestampSchema.parse(streamEvent.timestamp);

        // Handle tool approval requests
        if (sessionEvent.type === 'TOOL_APPROVAL_REQUEST') {
          const approvalData = sessionEvent.data as ToolApprovalRequestData & {
            toolCallId?: string;
          };
          const pendingApproval: PendingApproval = {
            toolCallId: approvalData.toolCallId || approvalData.requestId,
            toolCall: {
              name: approvalData.toolName,
              arguments: approvalData.input,
            },
            requestedAt: streamTimestamp,
            requestData: approvalData,
          };
          callbackRefs.current.onApprovalRequest?.(pendingApproval);
          return; // Don't process as regular session event
        }

        // Handle tool approval responses
        if (sessionEvent.type === 'TOOL_APPROVAL_RESPONSE') {
          const responseData = sessionEvent.data as { toolCallId: string };
          callbackRefs.current.onApprovalResponse?.(responseData.toolCallId);
          return; // Don't process as regular session event
        }

        // Route to specific session event handlers
        callbackRefs.current.onSessionEvent?.(sessionEvent);
        switch (sessionEvent.type) {
          case 'USER_MESSAGE':
            callbackRefs.current.onUserMessage?.(sessionEvent);
            break;
          case 'AGENT_MESSAGE':
            callbackRefs.current.onAgentMessage?.(sessionEvent);
            break;
          case 'AGENT_TOKEN':
            callbackRefs.current.onAgentToken?.(sessionEvent);
            break;
          case 'TOOL_CALL':
            callbackRefs.current.onToolCall?.(sessionEvent);
            break;
          case 'TOOL_RESULT':
            callbackRefs.current.onToolResult?.(sessionEvent);
            break;
          case 'LOCAL_SYSTEM_MESSAGE':
            callbackRefs.current.onSystemMessage?.(sessionEvent);
            break;
        }
      } else if (isTaskEvent(streamEvent)) {
        const taskEvent = streamEvent.data as TaskEvent;
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
      } else if (isAgentEvent(streamEvent)) {
        const agentEvent = streamEvent.data as AgentEvent;
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
      } else if (isProjectEvent(streamEvent)) {
        const projectEvent = streamEvent.data as ProjectEvent;
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
      } else if (isGlobalEvent(streamEvent)) {
        const globalEvent = streamEvent.data as GlobalEvent;
        callbackRefs.current.onGlobalEvent?.(globalEvent);
        if (globalEvent.type === 'system:notification') {
          callbackRefs.current.onSystemNotification?.(globalEvent);
        }
      }
    } catch (error) {
      console.error('[EVENT_STREAM] Failed to parse stream event:', error, streamEvent);
      callbackRefs.current.onError?.(error as Error);
    }
  }, []);

  // Connect to stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const queryString = buildQueryString(subscription);
    const url = `/api/events/stream${queryString ? `?${queryString}` : ''}`;

    console.log('[EVENT_STREAM] Connecting to:', url);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[EVENT_STREAM] Connected');
      setConnection((prev) => ({
        ...prev,
        connected: true,
        reconnectAttempts: 0,
      }));
      callbackRefs.current.onConnect?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const streamEvent = JSON.parse(event.data) as StreamEvent;

        console.log('[EVENT_STREAM] Received event:', streamEvent);

        setLastEvent(streamEvent);
        setSendCount((prev) => prev + 1);
        setConnection((prev) => ({
          ...prev,
          lastEventId: streamEvent.id,
        }));

        handleStreamEvent(streamEvent);
      } catch (error) {
        console.error('[EVENT_STREAM] Failed to parse event:', error);
        callbackRefs.current.onError?.(error as Error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[EVENT_STREAM] Connection error:', error);

      setConnection((prev) => {
        const newState = {
          ...prev,
          connected: false,
          reconnectAttempts: prev.reconnectAttempts + 1,
        };

        callbackRefs.current.onDisconnect?.();
        callbackRefs.current.onError?.(new Error('SSE connection failed'));

        // Auto-reconnect logic using current state
        if (autoReconnect && newState.reconnectAttempts < newState.maxReconnectAttempts) {
          console.log(
            `[EVENT_STREAM] Reconnecting in ${reconnectInterval}ms (attempt ${newState.reconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(
            () => {
              connect();
            },
            reconnectInterval * Math.pow(2, newState.reconnectAttempts - 1)
          ); // Exponential backoff
        }

        return newState;
      });
    };
  }, [subscription, buildQueryString, autoReconnect, reconnectInterval, handleStreamEvent]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    setConnection((prev) => ({ ...prev, reconnectAttempts: 0 }));
    connect();
  }, [connect]);

  // Close connection
  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnection((prev) => ({ ...prev, connected: false }));
  }, []);

  // Connect on mount, reconnect when subscription changes
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      setConnection((prev) => ({ ...prev, connected: false }));
    };
  }, [connect]);

  return {
    connection,
    lastEvent,
    sendCount,
    close,
    reconnect,
  };
}
