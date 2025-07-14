// ABOUTME: Server-sent events manager for broadcasting events to connected clients
// ABOUTME: Manages session-scoped SSE connections and event distribution

import { SessionEvent, ThreadId } from '@/types/api';

export class SSEManager {
  private static instance: SSEManager;
  private sessionStreams: Map<ThreadId, Set<ReadableStreamDefaultController<Uint8Array>>> = new Map();
  private encoder = new TextEncoder();

  private constructor() {}

  static getInstance(): SSEManager {
    if (!SSEManager.instance) {
      SSEManager.instance = new SSEManager();
    }
    return SSEManager.instance;
  }

  addConnection(sessionId: ThreadId, controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (!this.sessionStreams.has(sessionId)) {
      this.sessionStreams.set(sessionId, new Set());
    }
    this.sessionStreams.get(sessionId)!.add(controller);
  }

  removeConnection(sessionId: ThreadId, controller: ReadableStreamDefaultController<Uint8Array>): void {
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
    if (!controllers) return;

    const sseData = this.formatSSEEvent(event);
    const deadControllers: ReadableStreamDefaultController<Uint8Array>[] = [];

    controllers.forEach(controller => {
      try {
        controller.enqueue(this.encoder.encode(sseData));
      } catch (error) {
        // Controller is closed or errored
        deadControllers.push(controller);
      }
    });

    // Clean up dead controllers
    deadControllers.forEach(controller => {
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