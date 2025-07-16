// ABOUTME: Server-sent events manager for broadcasting events to connected clients
// ABOUTME: Manages session-scoped SSE connections and event distribution

import { SessionEvent, ThreadId } from '@/types/api';

// Use global to persist across HMR in development
declare global {
  var sseManager: SSEManager | undefined;
}

export class SSEManager {
  private sessionStreams: Map<ThreadId, Set<ReadableStreamDefaultController<Uint8Array>>> =
    new Map();
  private encoder = new TextEncoder();
  private readonly MAX_CONNECTIONS_PER_SESSION = 10;

  private constructor() {}

  static getInstance(): SSEManager {
    if (!global.sseManager) {
      global.sseManager = new SSEManager();
    }
    return global.sseManager;
  }

  addConnection(
    sessionId: ThreadId,
    controller: ReadableStreamDefaultController<Uint8Array>
  ): void {
    if (!this.sessionStreams.has(sessionId)) {
      this.sessionStreams.set(sessionId, new Set());
    }

    const controllers = this.sessionStreams.get(sessionId)!;

    // Check connection limit
    if (controllers.size >= this.MAX_CONNECTIONS_PER_SESSION) {
      throw new Error(
        `Maximum connections (${this.MAX_CONNECTIONS_PER_SESSION}) reached for session`
      );
    }

    controllers.add(controller);
  }

  removeConnection(
    sessionId: ThreadId,
    controller: ReadableStreamDefaultController<Uint8Array>
  ): void {
    const controllers = this.sessionStreams.get(sessionId);
    if (controllers) {
      controllers.delete(controller);
      if (controllers.size === 0) {
        this.sessionStreams.delete(sessionId);
      }
    }
  }

  broadcast(sessionId: ThreadId, event: SessionEvent): void {
    const controllers = this.sessionStreams.get(sessionId);
    if (!controllers || controllers.size === 0) {
      return;
    }

    const sseData = this.formatSSEEvent(event);
    const deadControllers: ReadableStreamDefaultController<Uint8Array>[] = [];

    controllers.forEach((controller) => {
      try {
        controller.enqueue(this.encoder.encode(sseData));
      } catch (_error) {
        // Controller is closed or errored
        deadControllers.push(controller);
      }
    });

    // Clean up dead controllers
    deadControllers.forEach((controller) => {
      this.removeConnection(sessionId, controller);
    });
  }

  private formatSSEEvent(event: SessionEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  getConnectionCount(sessionId: ThreadId): number {
    return this.sessionStreams.get(sessionId)?.size || 0;
  }

  getAllSessions(): ThreadId[] {
    return Array.from(this.sessionStreams.keys());
  }
}
