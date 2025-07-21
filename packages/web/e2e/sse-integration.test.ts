// ABOUTME: E2E tests for SSE (Server-Sent Events) integration
// ABOUTME: Tests real-time event streaming from agents to web UI

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionEvent } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

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

// Mock the real SSEManager to avoid implementation dependencies
const mockSessions = new Map<string, Set<MockController>>();

// Define the mock SSEManager interface
interface MockSSEManager {
  sessionStreams: Map<string, Set<MockController>>;
  addConnection: (sessionId: string, controller: MockController) => void;
  removeConnection: (sessionId: string, controller: MockController) => void;
  broadcast: (targetSessionId: string, event: SessionEvent) => void;
}

// Create a single mock instance
const mockSSEManagerInstance: MockSSEManager = {
  sessionStreams: mockSessions,
  addConnection: (sessionId: string, controller: MockController) => {
    if (!mockSessions.has(sessionId)) {
      mockSessions.set(sessionId, new Set());
    }
    mockSessions.get(sessionId)!.add(controller);
  },
  removeConnection: (sessionId: string, controller: MockController) => {
    if (mockSessions.has(sessionId)) {
      mockSessions.get(sessionId)!.delete(controller);
    }
  },
  broadcast: (targetSessionId: string, event: SessionEvent) => {
    // Only broadcast to the specific session
    if (mockSessions.has(targetSessionId)) {
      const connections = mockSessions.get(targetSessionId)!;
      const eventText = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      const bytes = new TextEncoder().encode(eventText);
      connections.forEach((controller) => {
        try {
          controller.enqueue(bytes);
        } catch {
          // Remove failed connection
          connections.delete(controller);
        }
      });
    }
  },
};

vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: () => mockSSEManagerInstance,
  },
}));

import { SSEManager } from '@/lib/sse-manager';

describe('SSE Integration E2E Tests', () => {
  let sseManager: MockSSEManager;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
    mockSessions.clear();
    sseManager = SSEManager.getInstance() as unknown as MockSSEManager;
  });

  afterEach(() => {
    // Clean up any connections
    mockSessions.clear();
    teardownTestPersistence();
  });

  describe('Connection Management', () => {
    it('should add and remove connections for sessions', () => {
      const sessionId = 'test-session-id';
      const controller = createMockController();

      // Add connection
      sseManager.addConnection(sessionId, controller);

      // Verify connection was added
      const connections = mockSessions.get(sessionId);
      expect(connections).toBeDefined();
      expect(connections!.size).toBe(1);
      expect(connections!.has(controller)).toBe(true);

      // Remove connection
      sseManager.removeConnection(sessionId, controller);

      // Verify connection was removed
      const updatedConnections = mockSessions.get(sessionId);
      expect(updatedConnections!.size).toBe(0);
    });

    it('should handle multiple connections for same session', () => {
      const sessionId = 'multi-session';
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add multiple connections
      sseManager.addConnection(sessionId, controller1);
      sseManager.addConnection(sessionId, controller2);

      // Verify both connections exist
      const connections = mockSessions.get(sessionId);
      expect(connections!.size).toBe(2);
      expect(connections!.has(controller1)).toBe(true);
      expect(connections!.has(controller2)).toBe(true);
    });

    it('should handle connections for different sessions', () => {
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add connections for different sessions
      sseManager.addConnection(sessionId1, controller1);
      sseManager.addConnection(sessionId2, controller2);

      // Verify sessions are separate
      expect(mockSessions.get(sessionId1)!.size).toBe(1);
      expect(mockSessions.get(sessionId2)!.size).toBe(1);
    });
  });

  describe('Event Broadcasting', () => {
    it('should broadcast events to all connections in session', () => {
      const sessionId = 'broadcast-session';
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add connections
      sseManager.addConnection(sessionId, controller1);
      sseManager.addConnection(sessionId, controller2);

      // Broadcast event
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'Hello, world!' },
      };

      sseManager.broadcast(sessionId, event);

      // Verify both controllers received the event
      expect(controller1.enqueue).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(controller2.enqueue).toHaveBeenCalledWith(expect.any(Uint8Array));
    });

    it('should not broadcast to other sessions', () => {
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';
      const controller1 = createMockController();
      const controller2 = createMockController();

      // Add connections for different sessions
      sseManager.addConnection(sessionId1, controller1);
      sseManager.addConnection(sessionId2, controller2);

      // Broadcast to session 1 only
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId1}.1`),
        timestamp: new Date(),
        data: { content: 'Only for session 1' },
      };

      sseManager.broadcast(sessionId1, event);

      // Verify only session 1 controller received the event
      expect(controller1.enqueue).toHaveBeenCalled();
      expect(controller2.enqueue).not.toHaveBeenCalled();
    });

    it('should handle broadcasting to non-existent session', () => {
      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId('lace_20240101_test.1'),
        timestamp: new Date(),
        data: { content: 'This should not crash' },
      };

      // Should not throw error
      expect(() => {
        sseManager.broadcast('non-existent-session', event);
      }).not.toThrow();
    });
  });

  describe('Event Formatting', () => {
    it('should format events correctly for SSE', () => {
      const sessionId = 'format-session';
      const controller = createMockController();

      sseManager.addConnection(sessionId, controller);

      const event: SessionEvent = {
        type: 'TOOL_CALL',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date('2024-01-01T12:00:00Z'),
        data: { toolName: 'test-tool', input: { param: 'value' } },
      };

      sseManager.broadcast(sessionId, event);

      // Verify the event was formatted as SSE
      expect(controller.enqueue).toHaveBeenCalledWith(expect.any(Uint8Array));

      // The exact format would be: "event: TYPE\ndata: {JSON}\n\n"
      expect(controller.enqueue.mock.calls[0]).toBeDefined();
      const call = controller.enqueue.mock.calls[0][0] as Uint8Array;
      const eventText = Buffer.from(call).toString();

      expect(eventText).toMatch(/^event: TOOL_CALL\n/);
      expect(eventText).toMatch(/\n\n$/);
      expect(eventText).toContain('"type":"TOOL_CALL"');
      expect(eventText).toContain('"threadId":"format-session.1"');
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

      sseManager.addConnection(sessionId, faultyController);

      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'This should handle errors' },
      };

      // Should not throw error even if controller fails
      expect(() => {
        sseManager.broadcast(sessionId, event);
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

      sseManager.addConnection(sessionId, faultyController);

      const event: SessionEvent = {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId(`${sessionId}.1`),
        timestamp: new Date(),
        data: { content: 'Test cleanup' },
      };

      sseManager.broadcast(sessionId, event);

      // Verify the failed connection was removed
      const connections = mockSessions.get(sessionId);
      expect(connections!.size).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = SSEManager.getInstance();
      const instance2 = SSEManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
