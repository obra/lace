// ABOUTME: Tests for compaction event streaming in SessionService
// ABOUTME: Verifies that compaction start/complete events are properly broadcast via SSE

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { SessionService } from './session-service';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { Session, Agent } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/types/core';

// Mock dependencies
vi.mock('@/lib/server/lace-imports', () => ({
  Session: {
    create: vi.fn(),
    getByIdSync: vi.fn(),
  },
  Agent: vi.fn(),
  ThreadManager: vi.fn(),
}));

vi.mock('@/lib/event-stream-manager', () => ({
  EventStreamManager: {
    getInstance: vi.fn(),
  },
}));

describe('SessionService compaction event streaming', () => {
  let sessionService: SessionService;
  let mockEventStreamManager: {
    broadcast: MockedFunction<(event: unknown) => void>;
    registerSession: MockedFunction<(session: unknown) => void>;
  };
  let mockSession: {
    getId: MockedFunction<() => ThreadId>;
    getProjectId: MockedFunction<() => string>;
    getAgent: MockedFunction<(threadId: ThreadId) => unknown>;
    getTaskManager: MockedFunction<() => unknown>;
  };
  let mockAgent: {
    on: MockedFunction<(event: string, handler: Function) => void>;
    off: MockedFunction<(event: string, handler: Function) => void>;
    threadId: ThreadId;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock EventStreamManager
    mockEventStreamManager = {
      broadcast: vi.fn(),
      registerSession: vi.fn(),
    };
    vi.mocked(EventStreamManager.getInstance).mockReturnValue(
      mockEventStreamManager as unknown as EventStreamManager
    );

    // Setup mock Agent
    const agentEventHandlers = new Map<string, Function[]>();
    mockAgent = {
      on: vi.fn((event: string, handler: Function) => {
        const handlers = agentEventHandlers.get(event) || [];
        handlers.push(handler);
        agentEventHandlers.set(event, handlers);
      }),
      off: vi.fn(),
      threadId: 'thread_123' as ThreadId,
    };

    // Add helper to trigger events for testing
    (mockAgent as unknown as { emit: (event: string, data: unknown) => void }).emit = (
      event: string,
      data: unknown
    ) => {
      const handlers = agentEventHandlers.get(event) || [];
      handlers.forEach((handler) => handler(data));
    };

    // Setup mock Session
    mockSession = {
      getId: vi.fn().mockReturnValue('session_123' as ThreadId),
      getProjectId: vi.fn().mockReturnValue('project_123'),
      getAgent: vi.fn().mockReturnValue(mockAgent),
      getTaskManager: vi.fn().mockReturnValue({}),
    };

    vi.mocked(Session.getByIdSync).mockReturnValue(mockSession as unknown as Session);
  });

  it('should broadcast COMPACTION_START event when agent starts thinking about compaction', () => {
    // Initialize service and register agent
    sessionService = new SessionService();

    // Set projectId for proper scope
    (sessionService as { projectId?: string }).projectId = 'project_123';

    // Setup agent event handlers
    sessionService.setupAgentEventHandlers(
      mockAgent as unknown as Agent,
      'session_123' as ThreadId
    );

    // Simulate agent emitting compaction start event
    (mockAgent as unknown as { emit: (event: string, data: unknown) => void }).emit(
      'compaction_start',
      {
        auto: true,
      }
    );

    // Verify broadcast was called with COMPACTION_START LaceEvent
    expect(mockEventStreamManager.broadcast).toHaveBeenCalledWith({
      type: 'COMPACTION_START',
      threadId: 'thread_123',
      timestamp: expect.any(Date),
      data: {
        auto: true,
      },
      context: {
        projectId: 'project_123',
        sessionId: 'session_123',
        agentId: undefined,
        taskId: undefined,
      },
      transient: true,
    });
  });

  it('should broadcast COMPACTION_COMPLETE event when agent completes thinking after compaction', () => {
    sessionService = new SessionService();
    (sessionService as { projectId?: string }).projectId = 'project_123';
    sessionService.setupAgentEventHandlers(
      mockAgent as unknown as Agent,
      'session_123' as ThreadId
    );

    // First emit start to set compaction in progress
    (mockAgent as unknown as { emit: (event: string, data: unknown) => void }).emit(
      'compaction_start',
      {
        auto: false,
      }
    );

    // Clear previous broadcasts
    mockEventStreamManager.broadcast.mockClear();

    // Then emit complete
    (mockAgent as unknown as { emit: (event: string, data: unknown) => void }).emit(
      'compaction_complete',
      {
        success: true,
      }
    );

    // Verify broadcast was called with COMPACTION_COMPLETE LaceEvent
    expect(mockEventStreamManager.broadcast).toHaveBeenCalledWith({
      type: 'COMPACTION_COMPLETE',
      threadId: 'thread_123',
      timestamp: expect.any(Date),
      data: {
        success: true,
      },
      context: {
        projectId: 'project_123',
        sessionId: 'session_123',
        agentId: undefined,
        taskId: undefined,
      },
      transient: true,
    });
  });

  it('should handle auto-compaction messages', () => {
    sessionService = new SessionService();
    (sessionService as { projectId?: string }).projectId = 'project_123';
    sessionService.setupAgentEventHandlers(
      mockAgent as unknown as Agent,
      'session_123' as ThreadId
    );

    // Simulate auto-compaction event
    (mockAgent as unknown as { emit: (event: string, data: unknown) => void }).emit(
      'compaction_start',
      {
        auto: true, // This indicates auto-compaction
      }
    );

    // Verify broadcast was called
    expect(mockEventStreamManager.broadcast).toHaveBeenCalledWith({
      type: 'COMPACTION_START',
      threadId: 'thread_123',
      timestamp: expect.any(Date),
      data: {
        auto: true, // Auto-compaction flag
      },
      context: {
        projectId: 'project_123',
        sessionId: 'session_123',
        agentId: undefined,
        taskId: undefined,
      },
      transient: true,
    });
  });

  it('should not broadcast for non-compaction thinking events', () => {
    sessionService = new SessionService();
    (sessionService as { projectId?: string }).projectId = 'project_123';
    sessionService.setupAgentEventHandlers(
      mockAgent as unknown as Agent,
      'session_123' as ThreadId
    );

    // Simulate regular thinking event
    (mockAgent as unknown as { emit: (event: string, data: unknown) => void }).emit(
      'agent_thinking_start',
      {
        message: 'Processing your request...',
      }
    );

    // Should not broadcast any compaction events
    expect(mockEventStreamManager.broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: expect.stringMatching(/COMPACTION/),
        }),
      })
    );
  });
});
