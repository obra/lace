// ABOUTME: Event stream manager for real-time client notifications
// ABOUTME: Manages global event distribution with client-side filtering

// StreamEvent removed - using LaceEvent directly
import type { Task, TaskContext, ThreadId, LaceEvent } from '@/types/core';
import type { Session } from '@/lib/server/lace-imports';
import { randomUUID } from 'crypto';
import { logger } from '~/utils/logger';
import { stringify } from '@/lib/serialization';

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
  private readonly KEEPALIVE_INTERVAL = 30000; // 30 seconds

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
        threadId: 'task-manager',
        data: { taskId: e.task.id, ...e },
        context: { projectId, sessionId, taskId: e.task.id },
        transient: true,
      });
    });

    taskManager.on('task:updated', (event: unknown) => {
      const e = event as TaskUpdatedEvent;
      this.broadcast({
        type: 'TASK_UPDATED',
        threadId: 'task-manager',
        data: { taskId: e.task?.id || '', ...e },
        context: { projectId, sessionId, taskId: e.task?.id },
        transient: true,
      });
    });

    taskManager.on('task:deleted', (event: unknown) => {
      const e = event as TaskDeletedEvent;
      this.broadcast({
        type: 'TASK_DELETED',
        threadId: 'task-manager',
        data: { ...e },
        context: { projectId, sessionId, taskId: e.taskId },
        transient: true,
      });
    });

    taskManager.on('task:note_added', (event: unknown) => {
      const e = event as TaskNoteAddedEvent;
      this.broadcast({
        type: 'TASK_NOTE_ADDED',
        threadId: 'task-manager',
        data: { taskId: e.task?.id || '', ...e },
        context: { projectId, sessionId, taskId: e.task?.id },
        transient: true,
      });
    });

    taskManager.on('agent:spawned', (event: unknown) => {
      const e = event as AgentSpawnedEvent;
      this.broadcast({
        type: 'AGENT_SPAWNED',
        threadId: e.agentThreadId,
        data: {
          type: e.type,
          taskId: e.taskId,
          agentThreadId: e.agentThreadId,
          provider: e.providerInstanceId,
          model: e.modelId,
          context: e.context,
          timestamp: e.timestamp,
        },
        context: { projectId, sessionId, taskId: e.taskId },
        transient: true,
      });
    });
  }

  // WeakSet to track registered TaskManager instances
  private static registeredTaskManagers = new WeakSet<object>();

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

    // Start keepalive if this is the first connection
    if (this.connections.size === 1) {
      this.startKeepAlive();
    }

    // Send connection confirmation as LaceEvent
    this.sendToConnection(connection, {
      id: this.generateEventId(),
      timestamp: new Date(),
      threadId: 'system',
      type: 'LOCAL_SYSTEM_MESSAGE',
      data: 'Ready!',
      transient: true,
    });

    return connectionId;
  }

  // Remove a client connection
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
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

    // Debug logging for event broadcasting
    if (process.env.NODE_ENV === 'development') {
      console.log(`[EVENT_STREAM_SERVER] Broadcasting event:`, {
        id: fullEvent.id,
        type: fullEvent.type,
        threadId: fullEvent.threadId,
        connections: this.connections.size,
        data:
          typeof fullEvent.data === 'string'
            ? fullEvent.data.substring(0, 100) + '...'
            : fullEvent.data,
      });
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

    // Thread filtering
    if (subscription.threads && subscription.threads.length > 0) {
      if (!subscription.threads.includes(event.threadId)) {
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

    // Debug logging for individual sends
    if (process.env.NODE_ENV === 'development') {
      console.log(`[EVENT_STREAM_SERVER] Sending to connection ${connection.id.substring(0, 8)}:`, {
        eventId: event.id,
        type: event.type,
        threadId: event.threadId,
        subscription: connection.subscription,
      });
    }

    try {
      connection.controller.enqueue(chunk);
      connection.lastEventId = event.id;
    } catch (error) {
      // Controller may have been closed between broadcast and send
      if (hasErrorCode(error) && error.code === 'ERR_INVALID_STATE') {
        throw new Error('Controller is closed');
      }
      throw error;
    }
  }

  // Generate unique event IDs
  private generateEventId(): string {
    return `${Date.now()}-${++this.eventIdCounter}`;
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

    // Send keepalive every 30 seconds
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
        // Check if controller is still open before trying to send
        if (connection.controller.desiredSize !== null) {
          connection.controller.enqueue(keepAliveBytes);
        } else {
          deadConnections.push(connectionId);
        }
      } catch (_error) {
        // Connection is dead
        deadConnections.push(connectionId);
      }
    }

    // Clean up dead connections
    for (const connectionId of deadConnections) {
      this.removeConnection(connectionId);
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
