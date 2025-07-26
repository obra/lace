// ABOUTME: Unit tests for SessionService methods required by service layer refactoring
// ABOUTME: Tests the missing methods needed to eliminate direct business logic calls from API routes

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/lib/server/lace-imports';

describe('SessionService after getProjectForSession removal', () => {
  it('should not have getProjectForSession method', () => {
    const sessionService = new SessionService();

    // This test should FAIL initially because method still exists
    expect(
      (sessionService as unknown as Record<string, unknown>).getProjectForSession
    ).toBeUndefined();
  });
});

describe('SessionService after getEffectiveConfiguration removal', () => {
  it('should not have getEffectiveConfiguration method', () => {
    const sessionService = new SessionService();

    // This test should FAIL initially because method still exists
    expect(
      (sessionService as unknown as Record<string, unknown>).getEffectiveConfiguration
    ).toBeUndefined();
  });
});

describe('SessionService after updateSessionConfiguration removal', () => {
  it('should not have updateSessionConfiguration method', () => {
    const sessionService = new SessionService();

    // This test should FAIL initially because method still exists
    expect(
      (sessionService as unknown as Record<string, unknown>).updateSessionConfiguration
    ).toBeUndefined();
  });
});

describe('SessionService after getSessionData removal', () => {
  it('should not have getSessionData method', () => {
    const sessionService = new SessionService();

    // This test should FAIL initially because method still exists
    expect((sessionService as unknown as Record<string, unknown>).getSessionData).toBeUndefined();
  });
});

// Mock SSEManager
vi.mock('@/lib/sse-manager', () => ({
  SSEManager: {
    getInstance: vi.fn(() => ({
      broadcast: vi.fn()
    }))
  }
}));

// Mock external dependencies (filesystem, database) but not business logic
vi.mock('~/persistence/database', () => {
  // Keep a simple in-memory store to test real behavior
  const sessionStore = new Map<string, Record<string, unknown>>();

  return {
    getPersistence: vi.fn(() => ({
      // Mock the persistence layer to use in-memory storage for testing
      updateSession: vi.fn((sessionId: string, updates: Record<string, unknown>) => {
        const existing = sessionStore.get(sessionId) || {};
        const updated = { ...existing, ...updates, updatedAt: new Date() };
        sessionStore.set(sessionId, updated);
      }),
      loadSession: vi.fn((sessionId: string) => {
        return sessionStore.get(sessionId) || null;
      }),
      saveSession: vi.fn((session: Record<string, unknown> & { id: string }) => {
        sessionStore.set(session.id, session);
      }),
    })),
  };
});

// Mock agent-utils
vi.mock('./agent-utils', () => ({
  setupAgentApprovals: vi.fn()
}));

// Mock Project.getById - external dependency for project validation
vi.mock('@/lib/server/lace-imports', async () => {
  const actual = await vi.importActual('@/lib/server/lace-imports');
  return {
    ...actual,
    Project: {
      getById: vi.fn((projectId: string) => ({ id: projectId, name: 'Test Project' })),
    },
    Session: {
      create: vi.fn(),
      getAll: vi.fn(),
      getById: vi.fn(),
      updateSession: vi.fn(),
      getSession: vi.fn()
    },
  };
});

describe('SessionService Missing Methods', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let Session: typeof import('@/lib/server/lace-imports').Session;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionService = getSessionService();
    sessionService.clearActiveSessions();

    // Import Session for use in tests
    const imports = await import('@/lib/server/lace-imports');
    Session = imports.Session;
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
  });

  describe('updateSession', () => {
    it('should update session metadata and persist changes', async () => {
      // Arrange: Create a session first
      const sessionId = asThreadId('test-session-id');

      // Create a session record in our mocked persistence
      const initialSessionData = {
        id: sessionId,
        name: 'Original Session',
        description: 'Original description',
        projectId: 'test-project',
        configuration: { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Save directly to mocked persistence
      const { getPersistence } = await import('~/persistence/database');
      getPersistence().saveSession(initialSessionData);

      const updates = { name: 'Updated Session', description: 'New description' };

      // Act: Update the session through the service
      sessionService.updateSession(sessionId, updates);

      // Assert: Verify the session was actually updated in persistence
      const updatedSession = Session.getSession(sessionId);
      expect(updatedSession).not.toBeNull();
      expect(updatedSession?.name).toBe('Updated Session');
      expect(updatedSession?.description).toBe('New description');
      expect(updatedSession?.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle partial updates correctly', async () => {
      // Arrange: Create a session with multiple properties
      const sessionId = asThreadId('test-session-partial');

      const initialSessionData = {
        id: sessionId,
        name: 'Original Session',
        description: 'Original description',
        projectId: 'test-project',
        configuration: { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Save directly to mocked persistence
      const { getPersistence } = await import('~/persistence/database');
      getPersistence().saveSession(initialSessionData);

      // Act: Update only one property
      const partialUpdates = { description: 'Partially updated description' };
      sessionService.updateSession(sessionId, partialUpdates);

      // Assert: Verify only the specified field was updated
      const updatedSession = Session.getSession(sessionId);
      expect(updatedSession?.name).toBe('Original Session'); // unchanged
      expect(updatedSession?.description).toBe('Partially updated description'); // changed
      expect(updatedSession?.projectId).toBe('test-project'); // unchanged
    });
  });
});

describe('SessionService approval event forwarding', () => {
  let sessionService: SessionService;
  let mockSSEManager: { broadcast: vi.Mock };
  let mockAgent: any;
  let mockSession: any;
  const sessionId = asThreadId('session-123');
  const threadId = asThreadId('thread-456');

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import SSEManager properly
    const { SSEManager } = await import('@/lib/sse-manager');
    mockSSEManager = {
      broadcast: vi.fn()
    };
    (SSEManager.getInstance as any).mockReturnValue(mockSSEManager);

    // Create mock agent with event emitter capabilities
    mockAgent = {
      threadId: threadId,
      on: vi.fn(),
      emit: vi.fn(),
      threadManager: {
        getEvents: vi.fn()
      },
      toolExecutor: {
        getTool: vi.fn()
      }
    };

    // Create mock session
    mockSession = {
      getId: () => sessionId,
      getAgent: vi.fn(() => mockAgent),
      getAgents: vi.fn(() => [{ threadId, name: 'test-agent' }]),
      getInfo: vi.fn(() => ({
        name: 'Test Session',
        createdAt: new Date()
      }))
    };

    sessionService = new SessionService();
  });

  it('should forward TOOL_APPROVAL_RESPONSE events to SSE', async () => {
    // Set up the agent event handlers
    const setupHandlers = (sessionService as any).setupAgentEventHandlers;
    setupHandlers.call(sessionService, mockAgent, sessionId);

    // Verify thread_event_added handler was registered
    expect(mockAgent.on).toHaveBeenCalledWith('thread_event_added', expect.any(Function));
    const threadEventHandler = mockAgent.on.mock.calls.find(
      (call: any) => call[0] === 'thread_event_added'
    )?.[1];

    expect(threadEventHandler).toBeDefined();

    // Simulate TOOL_APPROVAL_RESPONSE event
    const approvalResponseEvent = {
      id: 'evt-response-123',
      threadId: threadId,
      type: 'TOOL_APPROVAL_RESPONSE',
      timestamp: new Date(),
      data: {
        toolCallId: 'tool-call-123',
        decision: 'approve'
      }
    };

    // Call the handler
    await threadEventHandler({ 
      event: approvalResponseEvent, 
      threadId: threadId 
    });

    // Verify SSE broadcast was called for the approval response
    expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        type: 'TOOL_APPROVAL_RESPONSE',
        threadId: threadId,
        data: expect.objectContaining({
          toolCallId: 'tool-call-123',
          decision: 'approve'
        })
      })
    );
  });

  it('should handle TOOL_APPROVAL_REQUEST events (existing behavior)', async () => {
    // Set up the agent event handlers
    const setupHandlers = (sessionService as any).setupAgentEventHandlers;
    setupHandlers.call(sessionService, mockAgent, sessionId);

    const threadEventHandler = mockAgent.on.mock.calls.find(
      (call: any) => call[0] === 'thread_event_added'
    )?.[1];

    // Mock the tool call event lookup
    const mockToolCall = {
      id: 'tool-call-123',
      name: 'test-tool',
      arguments: { test: 'args' }
    };
    
    mockAgent.threadManager.getEvents.mockReturnValue([
      {
        type: 'TOOL_CALL',
        data: mockToolCall
      }
    ]);

    // Mock tool metadata
    mockAgent.toolExecutor.getTool.mockReturnValue({
      description: 'Test tool',
      annotations: { readOnlyHint: false }
    });

    // Simulate TOOL_APPROVAL_REQUEST event
    const approvalRequestEvent = {
      id: 'evt-request-123',
      threadId: threadId,
      type: 'TOOL_APPROVAL_REQUEST',
      timestamp: new Date(),
      data: {
        toolCallId: 'tool-call-123'
      }
    };

    // Call the handler
    await threadEventHandler({ 
      event: approvalRequestEvent, 
      threadId: threadId 
    });

    // Verify SSE broadcast was called for the approval request
    expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        type: 'TOOL_APPROVAL_REQUEST',
        threadId: threadId,
        data: expect.objectContaining({
          requestId: 'tool-call-123',
          toolName: 'test-tool'
        })
      })
    );
  });
});
