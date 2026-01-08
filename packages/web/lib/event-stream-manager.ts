// ABOUTME: Event stream manager for real-time client notifications
// ABOUTME: Manages global event distribution with client-side filtering

import type { AppEvent } from '@lace/web/types/app-events';
import type { WebEvent } from '@lace/web/types/web-events';
import { isProtocolEvent, isPermissionRequestEvent, isWebEvent } from '@lace/web/types/app-events';
import { randomUUID } from 'crypto';
import { logger } from '@lace/web/lib/logger';
import { stringify } from '@lace/web/lib/serialization';

// Type guard for errors with code property (Web Streams API errors)
function hasErrorCode(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

// No conversion needed - JSON.stringify happens at the network boundary

// Client connection with subscription filters
interface ClientConnection {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  subscription: {
    projects?: string[];
    sessions?: string[];
    threads?: string[]; // agent session IDs
    global?: boolean;
  };
  lastEventId?: string;
  connectedAt: Date;
  lastSendAt: number; // unix ms of last successful enqueue
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
      lastSendAt: Date.now(),
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

    // Send connection confirmation as WebEvent
    try {
      const readyEvent: WebEvent = {
        id: this.generateEventId(),
        timestamp: new Date(),
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { content: 'Ready!' },
      };
      this.sendToConnection(connection, readyEvent);
    } catch (error) {
      // Connection failed immediately - remove it
      logger.debug(`[EVENT_STREAM] Connection ${connectionId} failed on initial send`, error);
      this.removeConnection(connectionId);
      throw error;
    }

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

  // Broadcast AppEvent to all matching connections
  broadcast(event: AppEvent): void {
    // Ensure event has required fields
    const fullEvent: AppEvent = {
      ...event,
      id: event.id || this.generateEventId(),
      timestamp: event.timestamp || new Date(),
    };

    logger.debug('[EVENT_STREAM] Broadcasting AppEvent', {
      eventId: fullEvent.id,
      workspaceSessionId: fullEvent.workspaceSessionId,
      eventType: isProtocolEvent(fullEvent)
        ? fullEvent.update.type
        : isPermissionRequestEvent(fullEvent)
          ? 'permission_request'
          : isWebEvent(fullEvent)
            ? fullEvent.type
            : 'unknown',
    });

    const deadConnections: string[] = [];

    for (const [connectionId, connection] of this.connections) {
      if (this.shouldSendToConnection(connection, fullEvent)) {
        try {
          this.sendToConnection(connection, fullEvent);
        } catch (error) {
          logger.debug(`[EVENT_STREAM] Failed to send event to connection ${connectionId}:`, error);
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
  private shouldSendToConnection(connection: ClientConnection, event: AppEvent): boolean {
    const { subscription } = connection;

    // Extract context from AppEvent based on type
    let eventProjectId: string | undefined;
    let eventSessionId: string | undefined; // workspace session
    let eventThreadId: string | undefined; // agent session

    if (isProtocolEvent(event)) {
      eventProjectId = event.projectId;
      eventSessionId = event.workspaceSessionId;
      eventThreadId = event.agentSessionId;
    } else if (isPermissionRequestEvent(event)) {
      eventProjectId = event.projectId;
      eventSessionId = event.workspaceSessionId;
      eventThreadId = event.request.sessionId;
    } else if (isWebEvent(event)) {
      eventProjectId = event.projectId;
      eventSessionId = event.workspaceSessionId;
      eventThreadId = event.agentSessionId;
    }

    // Thread/agent session filtering
    if (subscription.threads && subscription.threads.length > 0) {
      if (!eventThreadId || !subscription.threads.includes(eventThreadId)) {
        return false;
      }
    }

    // Project filtering
    if (subscription.projects && subscription.projects.length > 0) {
      if (!eventProjectId || !subscription.projects.includes(eventProjectId)) {
        return false;
      }
    }

    // Session (workspace) filtering
    if (subscription.sessions && subscription.sessions.length > 0) {
      if (!eventSessionId || !subscription.sessions.includes(eventSessionId)) {
        return false;
      }
    }

    return true;
  }

  // Send AppEvent to specific connection
  private sendToConnection(connection: ClientConnection, event: AppEvent): void {
    const eventData = `id: ${event.id}\ndata: ${stringify(event)}\n\n`;
    const chunk = this.encoder.encode(eventData);

    try {
      connection.controller.enqueue(chunk);
      connection.lastEventId = event.id;
      connection.lastSendAt = Date.now();
    } catch (error) {
      logger.debug(`[EVENT_STREAM] Failed to send event to connection ${connection.id}`, {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });

      class ControllerClosedError extends Error {
        public readonly cause?: unknown;

        constructor(message: string, cause?: unknown) {
          super(message);
          this.name = 'ControllerClosedError';
          this.cause = cause;
        }
      }
      throw new ControllerClosedError('Controller is closed', error);
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

    // Send keepalive every 30 seconds to detect dead connections
    this.keepAliveInterval = setInterval(() => {
      this.sendKeepAlive();
    }, this.KEEPALIVE_INTERVAL);

    // Allow process to exit naturally if this is the only handle
    this.keepAliveInterval.unref?.();
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
        // Check controller state first
        if (connection.controller.desiredSize === null) {
          logger.debug(`[EVENT_STREAM] Controller desiredSize is null for ${connectionId}`);
          deadConnections.push(connectionId);
          continue;
        }

        const now = Date.now();

        // Check if connection hasn't had successful sends recently
        const timeSinceLastSend = now - connection.lastSendAt;
        const MAX_STALE_TIME = 90000; // 90 seconds without successful sends

        if (timeSinceLastSend > MAX_STALE_TIME) {
          logger.info(`[EVENT_STREAM] Connection ${connectionId} stale - no successful sends`, {
            timeSinceLastSend,
            lastSendAt: new Date(connection.lastSendAt).toISOString(),
          });
          deadConnections.push(connectionId);
          continue;
        }

        // Check for backpressure before sending
        if (
          typeof connection.controller.desiredSize === 'number' &&
          connection.controller.desiredSize <= 0
        ) {
          logger.debug(
            `[EVENT_STREAM] Connection ${connectionId} has backpressure (desiredSize: ${connection.controller.desiredSize})`
          );
        }

        // Force a write to detect dead connections
        connection.controller.enqueue(keepAliveBytes);
        connection.lastSendAt = now;

        // Check if the write caused immediate failure
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
