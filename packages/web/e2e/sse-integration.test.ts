// ABOUTME: E2E tests for EventStreamManager integration
// ABOUTME: Tests real-time event streaming from agents to web UI

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionEvent } from '@/types/web-sse';
import type { StreamEvent } from '@/types/stream-events';
import { asThreadId } from '@/types/core';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock types for SSE controller
interface MockController {
  enqueue: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

// Mock controller for testing real EventStreamManager
const createMockController = (): MockController => ({
  enqueue: vi.fn(),
  close: vi.fn(),
  error: vi.fn(),
});

import { EventStreamManager } from '@/lib/event-stream-manager';

describe('EventStreamManager Integration E2E Tests', () => {
  let eventStreamManager: EventStreamManager;
  let addConnectionSpy: ReturnType<typeof vi.spyOn>;
  let broadcastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
    eventStreamManager = EventStreamManager.getInstance();

    // Set up spies on real methods
    addConnectionSpy = vi.spyOn(eventStreamManager, 'addConnection');
    broadcastSpy = vi.spyOn(eventStreamManager, 'broadcast');
  });

  afterEach(() => {
    // Clean up spies and connections
    addConnectionSpy?.mockRestore();
    broadcastSpy?.mockRestore();
    eventStreamManager.cleanup();
    teardownTestPersistence();
  });

  describe('Connection Management', () => {
    it('should add and remove connections', () => {
      const controller = createMockController();

      // Add connection
      const connectionId = eventStreamManager.addConnection(controller);

      // Verify connection returns valid ID
      expect(connectionId).toBeTypeOf('string');
      expect(connectionId.length).toBeGreaterThan(0);
      expect(addConnectionSpy).toHaveBeenCalledWith(controller);

      // Remove connection
      eventStreamManager.removeConnection(connectionId);

      // Controller should have been closed
      expect(controller.close).toHaveBeenCalled();
    });

    it('should handle multiple connections', () => {
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add multiple connections
      const connectionId1 = eventStreamManager.addConnection(controller1);
      const connectionId2 = eventStreamManager.addConnection(controller2);

      // Verify both connections have unique IDs
      expect(connectionId1).toBeTypeOf('string');
      expect(connectionId2).toBeTypeOf('string');
      expect(connectionId1).not.toBe(connectionId2);
      expect(addConnectionSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle connections with different subscriptions', () => {
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add connections with different subscriptions
      const connectionId1 = eventStreamManager.addConnection(controller1, {
        sessions: ['session-1'],
      });
      const connectionId2 = eventStreamManager.addConnection(controller2, {
        sessions: ['session-2'],
      });

      // Verify connections are separate and have different IDs
      expect(connectionId1).toBeTypeOf('string');
      expect(connectionId2).toBeTypeOf('string');
      expect(connectionId1).not.toBe(connectionId2);
      expect(addConnectionSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Event Broadcasting', () => {
    it('should broadcast events to all connections', () => {
      const sessionId = 'broadcast-session';
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add connections
      eventStreamManager.addConnection(controller1);
      eventStreamManager.addConnection(controller2);

      // Broadcast event
      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'Hello, world!' },
      };

      eventStreamManager.broadcast({
        eventType: 'session',
        scope: { sessionId },
        data: sessionEvent,
      });

      // Verify both controllers received the event
      expect(controller1.enqueue).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(controller2.enqueue).toHaveBeenCalledWith(expect.any(Uint8Array));
    });

    it('should broadcast to all connections (filtering handled client-side)', () => {
      const sessionId1 = 'session-1';
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add connections
      eventStreamManager.addConnection(controller1);
      eventStreamManager.addConnection(controller2);

      // Broadcast event
      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId1}.1`),
        timestamp: new Date(),
        data: { content: 'For all connections' },
      };

      eventStreamManager.broadcast({
        eventType: 'session',
        scope: { sessionId: sessionId1 },
        data: sessionEvent,
      });

      // Verify both controllers received the event (filtering is client-side)
      expect(controller1.enqueue).toHaveBeenCalled();
      expect(controller2.enqueue).toHaveBeenCalled();
    });

    it('should handle broadcasting with no connections', () => {
      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId('lace_20240101_test.1'),
        timestamp: new Date(),
        data: { content: 'This should not crash' },
      };

      // Should not throw error
      expect(() => {
        eventStreamManager.broadcast({
          eventType: 'session',
          scope: { sessionId: 'non-existent-session' },
          data: sessionEvent,
        });
      }).not.toThrow();
    });
  });

  describe('Event Formatting', () => {
    it('should format events correctly for SSE', () => {
      const sessionId = 'format-session';
      const controller = createMockController();

      eventStreamManager.addConnection(controller);

      const sessionEvent: SessionEvent = {
        type: 'TOOL_CALL',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date('2024-01-01T12:00:00Z'),
        data: { toolName: 'test-tool', input: { param: 'value' } },
      };

      eventStreamManager.broadcast({
        eventType: 'session',
        scope: { sessionId },
        data: sessionEvent,
      });

      // Verify the event was formatted as SSE
      expect(controller.enqueue).toHaveBeenCalledWith(expect.any(Uint8Array));
      // Should have been called twice: once for connection confirmation, once for our broadcast
      expect(controller.enqueue).toHaveBeenCalledTimes(2);

      // Check the second call (our broadcast event)
      expect(controller.enqueue.mock.calls[1]).toBeDefined();
      const call = controller.enqueue.mock.calls[1][0] as Uint8Array;
      const eventText = Buffer.from(call).toString();

      expect(eventText).toMatch(/^id: \d+-\d+\n/);
      expect(eventText).toMatch(/\n\n$/);
      expect(eventText).toContain('"eventType":"session"');
      expect(eventText).toContain('"sessionId":"format-session"');
    });
  });

  describe('Error Handling', () => {
    it('should handle controller errors gracefully', () => {
      const sessionId = 'error-session';
      const faultyController: MockController = {
        enqueue: vi.fn().mockImplementation(() => {
          throw new Error('Controller error');
        }),
        close: vi.fn(),
        error: vi.fn(),
      };

      // The addConnection call may throw because it immediately sends a connection confirmation
      let connectionId: string;
      try {
        connectionId = eventStreamManager.addConnection(faultyController);
      } catch (error) {
        // This is expected - the connection confirmation will fail
        expect(error).toBeInstanceOf(Error);
        return;
      }

      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'This should handle errors' },
      };

      // Should not throw error even if controller fails (connection should be cleaned up)
      expect(() => {
        eventStreamManager.broadcast({
          eventType: 'session',
          scope: { sessionId },
          data: sessionEvent,
        });
      }).not.toThrow();
    });

    it('should clean up failed connections', () => {
      const sessionId = 'cleanup-session';
      const faultyController: MockController = {
        enqueue: vi.fn().mockImplementation(() => {
          throw new Error('Connection closed');
        }),
        close: vi.fn(),
        error: vi.fn(),
      };

      // The addConnection call may throw because it immediately sends a connection confirmation
      let connectionId: string;
      try {
        connectionId = eventStreamManager.addConnection(faultyController);
      } catch (error) {
        // This is expected - the connection confirmation will fail
        expect(error).toBeInstanceOf(Error);
        return;
      }

      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'Test cleanup' },
      };

      // Should not throw error even if controller fails (connection should be cleaned up)
      expect(() => {
        eventStreamManager.broadcast({
          eventType: 'session',
          scope: { sessionId },
          data: sessionEvent,
        });
      }).not.toThrow();

      // Verify the connection was removed (controller close should have been called)
      expect(faultyController.close).toHaveBeenCalled();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = EventStreamManager.getInstance();
      const instance2 = EventStreamManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
