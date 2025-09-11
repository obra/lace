// ABOUTME: Event stream manager for real-time client notifications
// ABOUTME: Manages global event distribution with client-side filtering

// StreamEvent removed - using LaceEvent directly
import type { Task, TaskContext, ThreadId, LaceEvent, ErrorType, ErrorPhase } from '@/types/core';
import { asThreadId } from '@/types/core';
import type { Session, Agent } from '@/lib/server/lace-imports';
import { randomUUID } from 'crypto';
import { logger } from '~/utils/logger';
import { stringify } from '@/lib/serialization';

// Interface for AGENT_ERROR event data
export interface AgentErrorEventData {
  errorType: ErrorType;
  message: string;
  stack?: string;
  context: {
    phase: ErrorPhase;
    providerName?: string;
    providerInstanceId?: string;
    modelId?: string;
    toolName?: string;
    toolCallId?: string;
    workingDirectory?: string;
    retryAttempt?: number;
  };
  isRetryable: boolean;
  retryCount: number;
}

// Type guard for errors with code property (Web Streams API errors)
function hasErrorCode(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

// No conversion needed - JSON.stringify happens at the network boundary

// TaskManager event interfaces
interface TaskCreatedEvent {
  type: 'task:created';
  task: Task;
  context: TaskContext;
  timestamp: Date;
}

interface TaskUpdatedEvent {
  type: 'task:updated';
  task: Task;
  context: TaskContext;
  timestamp: Date;
}

interface TaskDeletedEvent {
  type: 'task:deleted';
  taskId: string;
  task?: Task;
  context: TaskContext;
  timestamp: Date;
}

interface TaskNoteAddedEvent {
  type: 'task:note_added';
  task: Task;
  context: TaskContext;
  timestamp: Date;
}

interface AgentSpawnedEvent {
  type: 'agent:spawned';
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

// NOTE: These events come from our own TaskManager, so the types are known and safe.
// Using explicit casting to satisfy ESLint while maintaining type safety.

// Client connection with subscription filters
interface ClientConnection {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  subscription: {
    projects?: string[];
    sessions?: string[];
    threads?: string[];
    global?: boolean;
    // eventTypes removed - LaceEvent handles all types
  };
  lastEventId?: string;
  connectedAt: Date;
}

// Use global to persist across HMR in development
declare global {
  var eventStreamManager: EventStreamManager | undefined;
}

export class EventStreamManager {
  private connections: Map<string, ClientConnection> = new Map();
  private encoder = new TextEncoder();
  private readonly MAX_CONNECTIONS = 100; // Global limit
  private eventIdCounter = 0;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private readonly KEEPALIVE_INTERVAL = process.env.NODE_ENV === 'development' ? 5000 : 15000; // 5s dev, 15s prod
  private readonly MAX_CONNECTION_AGE = 10 * 60 * 1000; // 10 minutes maximum connection age

  private constructor() {
    this.startKeepAlive();
  }

  // Register a Session to forward its TaskManager events to the stream
  // Called once per Session instance from SessionService
  registerSession(session: Session): void {
    const taskManager = session.getTaskManager();
    const sessionId = session.getId();
    const projectId = session.getProjectId();

    // Use WeakSet to ensure we only add listeners once per TaskManager
    if (EventStreamManager.registeredTaskManagers.has(taskManager)) {
      return;
    }

    EventStreamManager.registeredTaskManagers.add(taskManager);

    // Convert TaskManager events to LaceEvent format
    taskManager.on('task:created', (event: unknown) => {
      const e = event as TaskCreatedEvent;
      this.broadcast({
        type: 'TASK_CREATED',
        data: { taskId: e.task.id, ...e },
        context: { projectId, sessionId, taskId: e.task.id },
        transient: true,
      });
    });

    taskManager.on('task:updated', (event: unknown) => {
      const e = event as TaskUpdatedEvent;
      this.broadcast({
        type: 'TASK_UPDATED',
        data: { taskId: e.task?.id || '', ...e },
        context: { projectId, sessionId, taskId: e.task?.id },
        transient: true,
      });
    });

    taskManager.on('task:deleted', (event: unknown) => {
      const e = event as TaskDeletedEvent;
      this.broadcast({
        type: 'TASK_DELETED',
        data: { ...e },
        context: { projectId, sessionId, taskId: e.taskId },
        transient: true,
      });
    });

    taskManager.on('task:note_added', (event: unknown) => {
      const e = event as TaskNoteAddedEvent;
      this.broadcast({
        type: 'TASK_NOTE_ADDED',
        data: { taskId: e.task?.id || '', ...e },
        context: { projectId, sessionId, taskId: e.task?.id },
        transient: true,
      });
    });

    taskManager.on('agent:spawned', (event: unknown) => {
      const e = event as AgentSpawnedEvent;
      this.broadcast({
        type: 'AGENT_SPAWNED',
        data: {
          type: e.type,
          taskId: e.taskId,
          agentThreadId: e.agentThreadId,
          provider: e.providerInstanceId,
          model: e.modelId,
          context: e.context,
          timestamp: e.timestamp,
        },
        context: { projectId, sessionId, taskId: e.taskId, threadId: e.agentThreadId },
        transient: true,
      });
    });

    // Handle agent spawning events to register error handlers for new agents
    taskManager.on('agent:spawned', (event: unknown) => {
      const e = event as { agentThreadId: string };
      const newAgent = session.getAgent(asThreadId(e.agentThreadId));
      if (newAgent) {
        this.registerAgentErrorHandler(newAgent, e.agentThreadId, projectId || '', sessionId || '');
      }
    });

    // Handle agent errors for existing agents
    const agents = session.getAgents();
    for (const agentInfo of agents) {
      const agent = session.getAgent(agentInfo.threadId);
      if (agent) {
        this.registerAgentErrorHandler(agent, agentInfo.threadId, projectId || '', sessionId || '');
      }
    }
  }

  // Extract agent error handler registration into reusable method
  private registerAgentErrorHandler(
    agent: Agent,
    agentThreadId: string,
    projectId: string,
    sessionId: string
  ): void {
    // Prevent duplicate error listeners on the same Agent instance
    if (EventStreamManager.registeredAgents.has(agent)) {
      return;
    }

    EventStreamManager.registeredAgents.add(agent);

    agent.on('error', (errorEvent: { error: Error; context: Record<string, unknown> }) => {
      const { error, context } = errorEvent;

      logger.debug(
        `[EVENT_STREAM] Agent ${agentThreadId} error occurred, broadcasting AGENT_ERROR`
      );

      this.broadcast({
        type: 'AGENT_ERROR',
        timestamp: new Date(),
        data: {
          errorType: context.errorType as ErrorType,
          message: error.message,
          fullError: error,
          stack: error.stack,
          context: {
            phase: context.phase as ErrorPhase,
            providerName: context.providerName as string | undefined,
            providerInstanceId: context.providerInstanceId as string | undefined,
            modelId: context.modelId as string | undefined,
            toolName: context.toolName as string | undefined,
            toolCallId: context.toolCallId as string | undefined,
            workingDirectory: context.workingDirectory as string | undefined,
            retryAttempt: context.retryAttempt as number | undefined,
          },
          isRetryable: context.isRetryable as boolean,
          retryCount: context.retryCount as number,
        },
        transient: true,
        context: {
          projectId,
          sessionId,
          threadId: agentThreadId,
        },
      });
    });
  }

  // Method to register error handlers for newly spawned agents (for manual spawning)
  registerAgentErrorHandlers(session: Session, agentThreadId: string): void {
    const agent = session.getAgent(asThreadId(agentThreadId));
    if (agent) {
      const projectId = session.getProjectId();
      const sessionId = session.getId();
      this.registerAgentErrorHandler(agent, agentThreadId, projectId || '', sessionId || '');
    }
  }

  // WeakSet to track registered TaskManager instances
  private static registeredTaskManagers = new WeakSet<object>();
  // WeakSet to track agents that already have error listeners registered
  private static registeredAgents = new WeakSet<Agent>();

  static getInstance(): EventStreamManager {
    if (!global.eventStreamManager) {
      global.eventStreamManager = new EventStreamManager();
    }
    return global.eventStreamManager;
  }

  // Add a new client connection
  addConnection(
    controller: ReadableStreamDefaultController<Uint8Array>,
    subscription: ClientConnection['subscription'] = {}
  ): string {
    // Check global connection limit
    if (this.connections.size >= this.MAX_CONNECTIONS) {
      // In development, clean up stale connections older than 5 minutes
      if (process.env.NODE_ENV === 'development') {
        this.cleanupStaleConnections();
        if (this.connections.size >= this.MAX_CONNECTIONS) {
          throw new Error(
            `Maximum connections (${this.MAX_CONNECTIONS}) reached even after cleanup`
          );
        }
      } else {
        throw new Error(`Maximum connections (${this.MAX_CONNECTIONS}) reached`);
      }
    }

    const connectionId = randomUUID();
    const connection: ClientConnection = {
      id: connectionId,
      controller,
      subscription,
      connectedAt: new Date(),
    };

    this.connections.set(connectionId, connection);

    // Log new connection
    logger.info('[EVENT_STREAM] New connection established', {
      connectionId,
      totalConnections: this.connections.size,
      subscription: {
        projects: subscription.projects?.length || 0,
        sessions: subscription.sessions?.length || 0,
        threads: subscription.threads?.length || 0,
        global: subscription.global,
      },
    });

    // Start keepalive if this is the first connection
    if (this.connections.size === 1) {
      this.startKeepAlive();
    }

    // Send connection confirmation as LaceEvent
    this.sendToConnection(connection, {
      id: this.generateEventId(),
      timestamp: new Date(),
      type: 'LOCAL_SYSTEM_MESSAGE',
      data: 'Ready!',
      transient: true,
      context: {
        systemMessage: true,
      },
    });

    return connectionId;
  }

  // Remove a client connection
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      const connectionDuration = Date.now() - connection.connectedAt.getTime();

      logger.info('[EVENT_STREAM] Removing connection', {
        connectionId,
        durationMs: connectionDuration,
        remainingConnections: this.connections.size - 1,
        lastEventId: connection.lastEventId,
      });

      try {
        // Check if controller is still open before trying to close
        if (connection.controller.desiredSize !== null) {
          connection.controller.close();
        }
      } catch (error) {
        // Connection may already be closed - only log if it's an unexpected error
        if (!hasErrorCode(error) || error.code !== 'ERR_INVALID_STATE') {
          logger.debug(`[EVENT_STREAM] Error closing connection ${connectionId}:`, error);
        }
      }
      this.connections.delete(connectionId);
    } else {
      logger.debug('[EVENT_STREAM] Attempted to remove non-existent connection', { connectionId });
    }
  }

  // Broadcast event to all matching connections
  broadcast(event: LaceEvent): void {
    // Ensure event has required fields
    const fullEvent: LaceEvent = {
      ...event,
      id: event.id || this.generateEventId(),
      timestamp: event.timestamp || new Date(),
    };

    // Comprehensive trace logging for event broadcasting
    logger.debug('[EVENT_STREAM] Broadcasting event', {
      eventId: fullEvent.id,
      type: fullEvent.type,
      contextThreadId: fullEvent.context?.threadId,
      dataSize:
        typeof fullEvent.data === 'string'
          ? fullEvent.data.length
          : JSON.stringify(fullEvent.data || {}).length,
      dataPreview: this.truncateEventData(fullEvent.data),
      contextProjectId: fullEvent.context?.projectId,
      contextSessionId: fullEvent.context?.sessionId,
      contextTaskId: fullEvent.context?.taskId,
      connectionCount: this.connections.size,
      timestamp: fullEvent.timestamp,
    });

    // Optional: Add debug logging for error events
    if (fullEvent.type === 'AGENT_ERROR') {
      // Runtime guard for safe error data access
      const data = fullEvent.data;
      if (
        data &&
        typeof data === 'object' &&
        'errorType' in data &&
        'context' in data &&
        'isRetryable' in data &&
        data.context &&
        typeof data.context === 'object' &&
        'phase' in data.context
      ) {
        const errorData = data as AgentErrorEventData;
        logger.debug('[EVENT_STREAM] Broadcasting agent error event', {
          contextThreadId: fullEvent.context?.threadId,
          errorType: errorData.errorType,
          phase: errorData.context.phase,
          isRetryable: errorData.isRetryable,
        });
      } else {
        logger.debug('[EVENT_STREAM] Broadcasting agent error event with invalid data shape', {
          contextThreadId: fullEvent.context?.threadId,
          rawData: data,
        });
      }
    }

    const deadConnections: string[] = [];

    for (const [connectionId, connection] of this.connections) {
      if (this.shouldSendToConnection(connection, fullEvent)) {
        try {
          this.sendToConnection(connection, fullEvent);
        } catch (error) {
          logger.debug(`[EVENT_STREAM] Failed to send to connection ${connectionId}:`, error);
          deadConnections.push(connectionId);
        }
      }
    }

    // Clean up dead connections
    for (const connectionId of deadConnections) {
      this.removeConnection(connectionId);
    }
  }

  // Check if event should be sent to connection based on subscription
  private shouldSendToConnection(connection: ClientConnection, event: LaceEvent): boolean {
    const { subscription } = connection;

    // Thread filtering - use context.threadId instead of top-level threadId
    if (subscription.threads && subscription.threads.length > 0) {
      const eventThreadId = event.context?.threadId;
      if (!eventThreadId || !subscription.threads.includes(eventThreadId)) {
        return false;
      }
    }

    // Project filtering via context
    if (subscription.projects && subscription.projects.length > 0) {
      if (!event.context?.projectId || !subscription.projects.includes(event.context.projectId)) {
        return false;
      }
    }

    // Session filtering via context
    if (subscription.sessions && subscription.sessions.length > 0) {
      if (!event.context?.sessionId || !subscription.sessions.includes(event.context.sessionId)) {
        return false;
      }
    }

    // Event type filtering removed - LaceEvent handles all types

    // Global filtering - include all if subscription.global is true
    if (subscription.global === true) {
      return true;
    }

    return true;
  }

  // Send event to specific connection
  private sendToConnection(connection: ClientConnection, event: LaceEvent): void {
    const eventData = `id: ${event.id}\ndata: ${stringify(event)}\n\n`;
    const chunk = this.encoder.encode(eventData);

    // Trace logging for individual sends
    logger.debug('[EVENT_STREAM] Sending event to connection', {
      connectionId: connection.id,
      eventId: event.id,
      eventType: event.type,
      payloadSize: chunk.length,
      connectedAt: connection.connectedAt,
      subscription: {
        projects: connection.subscription.projects?.length || 0,
        sessions: connection.subscription.sessions?.length || 0,
        threads: connection.subscription.threads?.length || 0,
        global: connection.subscription.global,
      },
    });

    try {
      connection.controller.enqueue(chunk);
      connection.lastEventId = event.id;
    } catch (error) {
      // Any error during enqueue indicates a dead connection
      logger.debug(`[EVENT_STREAM] Failed to send event to connection ${connection.id}`, {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
        connectionAge: Date.now() - connection.connectedAt.getTime(),
      });
      throw new Error('Controller is closed');
    }
  }

  // Generate unique event IDs
  private generateEventId(): string {
    return `${Date.now()}-${++this.eventIdCounter}`;
  }

  // Helper to truncate event data for logging
  private truncateEventData(data: unknown): string {
    if (data === undefined || data === null) {
      return 'null';
    }

    const maxLength = 200;
    let dataStr: string;

    if (typeof data === 'string') {
      dataStr = data;
    } else if (typeof data === 'object') {
      try {
        dataStr = JSON.stringify(data);
      } catch (_error) {
        dataStr = '[Circular or non-serializable object]';
      }
    } else {
      dataStr = String(data);
    }

    if (dataStr.length <= maxLength) {
      return dataStr;
    }

    return dataStr.substring(0, maxLength) + '...[truncated]';
  }

  // Get connection stats for debugging
  getStats(): {
    totalConnections: number;
    connectionsByScope: Record<string, number>;
    oldestConnection: Date | null;
  } {
    const stats = {
      totalConnections: this.connections.size,
      connectionsByScope: {} as Record<string, number>,
      oldestConnection: null as Date | null,
    };

    let oldest: Date | null = null;

    for (const connection of this.connections.values()) {
      // Track oldest connection
      if (!oldest || connection.connectedAt < oldest) {
        oldest = connection.connectedAt;
      }

      // Count by subscription scope
      const scopes: string[] = [];
      if (connection.subscription.projects?.length) {
        scopes.push(`projects:${connection.subscription.projects.length}`);
      }
      if (connection.subscription.sessions?.length) {
        scopes.push(`sessions:${connection.subscription.sessions.length}`);
      }
      if (connection.subscription.threads?.length) {
        scopes.push(`threads:${connection.subscription.threads.length}`);
      }
      if (connection.subscription.global) {
        scopes.push('global');
      }

      const scopeKey = scopes.length > 0 ? scopes.join('+') : 'unfiltered';
      stats.connectionsByScope[scopeKey] = (stats.connectionsByScope[scopeKey] || 0) + 1;
    }

    stats.oldestConnection = oldest;
    return stats;
  }

  // Start keepalive timer
  private startKeepAlive(): void {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Send keepalive more frequently in development for faster dead connection detection
    this.keepAliveInterval = setInterval(() => {
      this.sendKeepAlive();
    }, this.KEEPALIVE_INTERVAL);
  }

  // Stop keepalive timer
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  // Send keepalive comment to all connections
  private sendKeepAlive(): void {
    const deadConnections: string[] = [];
    const keepAliveData = `: keepalive ${new Date().toISOString()}\n\n`;
    const keepAliveBytes = this.encoder.encode(keepAliveData);

    for (const [connectionId, connection] of this.connections) {
      try {
        // Check connection age first - force disconnect old connections
        const connectionAge = Date.now() - connection.connectedAt.getTime();
        if (connectionAge > this.MAX_CONNECTION_AGE) {
          logger.info(
            `[EVENT_STREAM] Connection ${connectionId} exceeded max age (${connectionAge}ms)`,
            {
              connectionAge,
              maxAge: this.MAX_CONNECTION_AGE,
            }
          );
          deadConnections.push(connectionId);
          continue;
        }

        // Check controller state first
        if (connection.controller.desiredSize === null) {
          logger.debug(`[EVENT_STREAM] Controller desiredSize is null for ${connectionId}`);
          deadConnections.push(connectionId);
          continue;
        }

        // Force a write to detect dead connections
        connection.controller.enqueue(keepAliveBytes);

        // Check if the write caused any state changes
        if (connection.controller.desiredSize === null) {
          logger.debug(`[EVENT_STREAM] Controller became null after enqueue for ${connectionId}`);
          deadConnections.push(connectionId);
        }
      } catch (error) {
        // Connection is dead - any write error means we should clean up
        logger.debug(`[EVENT_STREAM] Keepalive failed for connection ${connectionId}`, {
          error: error instanceof Error ? error.message : String(error),
          desiredSize: connection.controller.desiredSize,
        });
        deadConnections.push(connectionId);
      }
    }

    // Clean up dead connections immediately
    if (deadConnections.length > 0) {
      logger.info(
        `[EVENT_STREAM] Cleaning up ${deadConnections.length} dead connections from keepalive`
      );
      for (const connectionId of deadConnections) {
        this.removeConnection(connectionId);
      }
    }

    // Stop keepalive if no connections
    if (this.connections.size === 0) {
      this.stopKeepAlive();
    }
  }

  // Clean up stale connections (for development)
  private cleanupStaleConnections(): void {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const staleConnections: string[] = [];

    for (const [connectionId, connection] of this.connections) {
      if (connection.connectedAt < fiveMinutesAgo) {
        staleConnections.push(connectionId);
      }
    }

    for (const connectionId of staleConnections) {
      this.removeConnection(connectionId);
    }
  }

  // Clean up all connections (for shutdown)
  cleanup(): void {
    for (const connectionId of this.connections.keys()) {
      this.removeConnection(connectionId);
    }
  }
}
