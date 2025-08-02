// ABOUTME: Event stream manager for real-time client notifications
// ABOUTME: Manages global event distribution with client-side filtering

import type { StreamEvent, EventType } from '@/types/stream-events';
import type { Task, TaskContext, ThreadId } from '@/lib/core';
import type { Session } from '@/lib/server/lace-imports';
import { randomUUID } from 'crypto';

// TaskManager event interfaces
interface TaskCreatedEvent {
  type: 'task:created';
  task: Task;
  context: TaskContext;
  timestamp: string;
}

interface TaskUpdatedEvent {
  type: 'task:updated';
  task: Task;
  context: TaskContext;
  timestamp: string;
}

interface TaskDeletedEvent {
  type: 'task:deleted';
  taskId: string;
  task?: Task;
  context: TaskContext;
  timestamp: string;
}

interface TaskNoteAddedEvent {
  type: 'task:note_added';
  task: Task;
  context: TaskContext;
  timestamp: string;
}

interface AgentSpawnedEvent {
  type: 'agent:spawned';
  taskId: string;
  agentThreadId: ThreadId;
  provider: string;
  model: string;
  context: TaskContext;
  timestamp: string;
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
    eventTypes?: EventType[];
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

  private constructor() {}

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

    // Forward all TaskManager events - these are known types from our own TaskManager
    taskManager.on('task:created', (event: unknown) => {
      const e = event as TaskCreatedEvent;
      this.broadcast({
        eventType: 'task',
        scope: { projectId, sessionId, taskId: e.task.id },
        data: { type: 'task:created', ...e },
      });
    });

    taskManager.on('task:updated', (event: unknown) => {
      const e = event as TaskUpdatedEvent;
      this.broadcast({
        eventType: 'task',
        scope: { projectId, sessionId, taskId: e.task?.id },
        data: { type: 'task:updated', ...e },
      });
    });

    taskManager.on('task:deleted', (event: unknown) => {
      const e = event as TaskDeletedEvent;
      this.broadcast({
        eventType: 'task',
        scope: { projectId, sessionId, taskId: e.taskId },
        data: { type: 'task:deleted', ...e },
      });
    });

    taskManager.on('task:note_added', (event: unknown) => {
      const e = event as TaskNoteAddedEvent;
      this.broadcast({
        eventType: 'task',
        scope: { projectId, sessionId, taskId: e.task?.id },
        data: { type: 'task:note_added', ...e },
      });
    });

    taskManager.on('agent:spawned', (event: unknown) => {
      const e = event as AgentSpawnedEvent;
      this.broadcast({
        eventType: 'task',
        scope: { projectId, sessionId, taskId: e.taskId },
        data: { type: 'agent:spawned', ...e },
      });
    });
  }

  // WeakSet to track registered TaskManager instances
  private static registeredTaskManagers = new WeakSet<unknown>();

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

    // Send connection confirmation
    this.sendToConnection(connection, {
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
      eventType: 'global',
      scope: { global: true },
      data: {
        type: 'system:notification',
        message: 'Connected to unified event stream',
        severity: 'info',
        context: { actor: 'system', isHuman: false },
        timestamp: new Date().toISOString(),
      },
    });

    return connectionId;
  }

  // Remove a client connection
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.controller.close();
      } catch (error) {
        // Connection may already be closed
        console.warn(`[EVENT_STREAM] Error closing connection ${connectionId}:`, error);
      }
      this.connections.delete(connectionId);
    }
  }

  // Broadcast event to all matching connections
  broadcast(event: Omit<StreamEvent, 'id' | 'timestamp'>): void {
    const fullEvent: StreamEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date().toISOString(),
    };

    const deadConnections: string[] = [];

    for (const [connectionId, connection] of this.connections) {
      if (this.shouldSendToConnection(connection, fullEvent)) {
        try {
          this.sendToConnection(connection, fullEvent);
        } catch (error) {
          console.error(`[EVENT_STREAM] Failed to send to connection ${connectionId}:`, error);
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
  private shouldSendToConnection(connection: ClientConnection, event: StreamEvent): boolean {
    const { subscription } = connection;

    // Global events
    if (event.eventType === 'global') {
      return subscription.global === true;
    }

    // Project filtering
    if (subscription.projects && event.scope.projectId) {
      if (!subscription.projects.includes(event.scope.projectId)) {
        return false;
      }
    }

    // Session filtering
    if (subscription.sessions && event.scope.sessionId) {
      if (!subscription.sessions.includes(event.scope.sessionId)) {
        return false;
      }
    }

    // Thread filtering
    if (subscription.threads && event.scope.threadId) {
      if (!subscription.threads.includes(event.scope.threadId)) {
        return false;
      }
    }

    // Event type filtering (filters by top-level eventType, not event.data.type)
    if (subscription.eventTypes && subscription.eventTypes.length > 0) {
      if (!subscription.eventTypes.includes(event.eventType)) {
        return false;
      }
    }

    return true;
  }

  // Send event to specific connection
  private sendToConnection(connection: ClientConnection, event: StreamEvent): void {
    const eventData = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    const chunk = this.encoder.encode(eventData);
    connection.controller.enqueue(chunk);
    connection.lastEventId = event.id;
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
