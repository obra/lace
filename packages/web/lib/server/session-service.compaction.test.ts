// ABOUTME: Tests for compaction event streaming in SessionService
// ABOUTME: Verifies that compaction start/complete events are properly broadcast via SSE

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { SessionService } from './session-service';
import { EventStreamManager } from '@/lib/event-stream-manager';
import { Session, Agent } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/types/core';
import { createMockAgent } from '@/test-utils/mock-agent';

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
  let mockAgent: ReturnType<typeof createMockAgent>;

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

    // Setup mock Agent using shared utility
    mockAgent = createMockAgent({
      threadId: 'thread_123' as ThreadId,
      getFullSession: async () =>
        ({
          getId: () => 'session_123',
          getProjectId: () => 'project_123',
        }) as Session,
    });

    // Setup mock Session
    mockSession = {
      getId: vi.fn().mockReturnValue('session_123' as ThreadId),
      getProjectId: vi.fn().mockReturnValue('project_123'),
      getAgent: vi.fn().mockReturnValue(mockAgent),
      getTaskManager: vi.fn().mockReturnValue({}),
    };

    vi.mocked(Session.getByIdSync).mockReturnValue(mockSession as unknown as Session);
  });

  it('should broadcast COMPACTION_START event when agent starts thinking about compaction', async () => {
    // Initialize service and register agent
    sessionService = new SessionService();

    // Set projectId for proper scope
    (sessionService as { projectId?: string }).projectId = 'project_123';

    // Setup agent event handlers
    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

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
      timestamp: expect.any(Date),
      data: {
        auto: true,
      },
      context: {
        projectId: 'project_123',
        sessionId: 'session_123',
        agentId: undefined,
        taskId: undefined,
        threadId: 'thread_123',
      },
      transient: true,
    });
  });

  it('should broadcast COMPACTION_COMPLETE event when agent completes thinking after compaction', async () => {
    sessionService = new SessionService();
    (sessionService as { projectId?: string }).projectId = 'project_123';
    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

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
      timestamp: expect.any(Date),
      data: {
        success: true,
      },
      context: {
        projectId: 'project_123',
        sessionId: 'session_123',
        agentId: undefined,
        taskId: undefined,
        threadId: 'thread_123',
      },
      transient: true,
    });
  });

  it('should handle auto-compaction messages', async () => {
    sessionService = new SessionService();
    (sessionService as { projectId?: string }).projectId = 'project_123';
    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

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
      timestamp: expect.any(Date),
      data: {
        auto: true, // Auto-compaction flag
      },
      context: {
        projectId: 'project_123',
        sessionId: 'session_123',
        agentId: undefined,
        taskId: undefined,
        threadId: 'thread_123',
      },
      transient: true,
    });
  });

  it('should not broadcast for non-compaction thinking events', async () => {
    sessionService = new SessionService();
    (sessionService as { projectId?: string }).projectId = 'project_123';
    await sessionService.setupAgentEventHandlers(mockAgent as unknown as Agent);

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
