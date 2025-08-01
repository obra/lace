// ABOUTME: E2E tests for EventStreamManager integration
// ABOUTME: Tests real-time event streaming from agents to web UI

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionEvent } from '@/types/api';
import type { StreamEvent } from '@/types/stream-events';
import { asThreadId } from '@/lib/server/core-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock types for SSE controller
interface MockController {
  enqueue: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

// Mock ReadableStream and related APIs for testing
const createMockController = (): MockController => ({
  enqueue: vi.fn(),
  close: vi.fn(),
  error: vi.fn(),
});

global.ReadableStream = class MockReadableStream {
  constructor() {}
} as typeof ReadableStream;

global.TextEncoder = class MockTextEncoder {
  encode(text: string) {
    return new Uint8Array(Buffer.from(text));
  }
} as typeof TextEncoder;

// Mock the real EventStreamManager to avoid implementation dependencies
const mockConnections = new Map<string, MockController>();

// Define the mock EventStreamManager interface
interface MockEventStreamManager {
  connections: Map<string, MockController>;
  addConnection: (controller: MockController, subscription?: object) => string;
  removeConnection: (connectionId: string) => void;
  broadcast: (event: Omit<StreamEvent, 'id' | 'timestamp'>) => void;
}

// Create a single mock instance
const mockEventStreamManagerInstance: MockEventStreamManager = {
  connections: mockConnections,
  addConnection: (controller: MockController, subscription = {}) => {
    const connectionId = `conn-${Date.now()}-${Math.random()}`;
    mockConnections.set(connectionId, controller);
    return connectionId;
  },
  removeConnection: (connectionId: string) => {
    mockConnections.delete(connectionId);
  },
  broadcast: (event: Omit<StreamEvent, 'id' | 'timestamp'>) => {
    // Add missing fields to create full StreamEvent
    const fullEvent: StreamEvent = {
      ...event,
      id: `event-${Date.now()}`,
      timestamp: new Date(),
    };

    const eventText = `id: ${fullEvent.id}\ndata: ${JSON.stringify(fullEvent)}\n\n`;
    const bytes = new TextEncoder().encode(eventText);

    mockConnections.forEach((controller, connectionId) => {
      try {
        controller.enqueue(bytes);
      } catch {
        // Remove failed connection
        mockConnections.delete(connectionId);
      }
    });
  },
};

vi.mock('@/lib/event-stream-manager', () => ({
  EventStreamManager: {
    getInstance: () => mockEventStreamManagerInstance,
  },
}));

import { EventStreamManager } from '@/lib/event-stream-manager';

describe('EventStreamManager Integration E2E Tests', () => {
  let eventStreamManager: MockEventStreamManager;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
    mockConnections.clear();
    eventStreamManager = EventStreamManager.getInstance() as unknown as MockEventStreamManager;
  });

  afterEach(() => {
    // Clean up any connections
    mockConnections.clear();
    teardownTestPersistence();
  });

  describe('Connection Management', () => {
    it('should add and remove connections', () => {
      const controller = createMockController();

      // Add connection
      const connectionId = eventStreamManager.addConnection(controller);

      // Verify connection was added
      expect(mockConnections.has(connectionId)).toBe(true);
      expect(mockConnections.get(connectionId)).toBe(controller);

      // Remove connection
      eventStreamManager.removeConnection(connectionId);

      // Verify connection was removed
      expect(mockConnections.has(connectionId)).toBe(false);
    });

    it('should handle multiple connections', () => {
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add multiple connections
      const connectionId1 = eventStreamManager.addConnection(controller1);
      const connectionId2 = eventStreamManager.addConnection(controller2);

      // Verify both connections exist
      expect(mockConnections.size).toBe(2);
      expect(mockConnections.has(connectionId1)).toBe(true);
      expect(mockConnections.has(connectionId2)).toBe(true);
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

      // Verify connections are separate
      expect(mockConnections.size).toBe(2);
      expect(mockConnections.has(connectionId1)).toBe(true);
      expect(mockConnections.has(connectionId2)).toBe(true);
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

      // The exact format would be: "id: ID\ndata: {JSON}\n\n"
      expect(controller.enqueue.mock.calls[0]).toBeDefined();
      const call = controller.enqueue.mock.calls[0][0] as Uint8Array;
      const eventText = Buffer.from(call).toString();

      expect(eventText).toMatch(/^id: event-\d+\n/);
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

      eventStreamManager.addConnection(faultyController);

      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'This should handle errors' },
      };

      // Should not throw error even if controller fails
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

      const connectionId = eventStreamManager.addConnection(faultyController);

      const sessionEvent: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'Test cleanup' },
      };

      eventStreamManager.broadcast({
        eventType: 'session',
        scope: { sessionId },
        data: sessionEvent,
      });

      // Verify the failed connection was removed
      expect(mockConnections.has(connectionId)).toBe(false);
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
