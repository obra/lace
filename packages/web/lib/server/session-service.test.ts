// ABOUTME: Unit tests for SessionService methods required by service layer refactoring
// ABOUTME: Tests the missing methods needed to eliminate direct business logic calls from API routes

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { asThreadId, Agent, Session } from '@/lib/server/lace-imports';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { TestProvider } from '~/test-utils/test-provider';

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
    Session: actual.Session,
    ProviderRegistry: {
      getProvider: vi.fn(),
      createProvider: vi.fn(),
      createWithAutoDiscovery: vi.fn(),
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
  const tempDirContext = useTempLaceDir();
  let sessionService: SessionService;
  let mockSSEManager: { broadcast: vi.Mock };
  let session: Session;
  let agent: Agent;
  let testProvider: TestProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock SSEManager
    const { SSEManager } = await import('@/lib/sse-manager');
    mockSSEManager = {
      broadcast: vi.fn()
    };
    (SSEManager.getInstance as vi.Mock).mockReturnValue(mockSSEManager);

    // Mock Project.getById
    const { Project } = await import('@/lib/server/lace-imports');
    vi.spyOn(Project, 'getById').mockReturnValue({
      getId: () => 'test-project',
      getName: () => 'Test Project',
      getPath: () => '/test/path'
    } as any);

    // Create test provider
    testProvider = new TestProvider();
    
    // Mock ProviderRegistry to return our test provider
    const { ProviderRegistry } = await import('@/lib/server/lace-imports');
    vi.mocked(ProviderRegistry.getProvider).mockReturnValue(testProvider);
    vi.mocked(ProviderRegistry.createProvider).mockReturnValue(testProvider);
    vi.mocked(ProviderRegistry.createWithAutoDiscovery).mockReturnValue({
      createProvider: vi.fn().mockReturnValue(testProvider)
    } as any);

    sessionService = new SessionService();

    // Create a real session with real agent
    const sessionData = await sessionService.createSession(
      'Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      'test-project'
    );

    session = (await Session.getById(asThreadId(sessionData.id)))!;
    agent = session.getAgent(asThreadId(sessionData.id))!;
  });

  afterEach(async () => {
    if (agent) {
      agent.stop();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    sessionService.clearActiveSessions();
    vi.restoreAllMocks();
  });

  it('should forward TOOL_APPROVAL_RESPONSE events to SSE', async () => {
    // Create a real TOOL_APPROVAL_RESPONSE event
    const { ThreadManager } = await import('@/lib/server/lace-imports');
    const threadManager = new ThreadManager();
    
    const approvalResponseEvent = threadManager.addEvent(asThreadId(session.getId()), 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'tool-call-123',
      decision: 'approve'
    });

    // Emit the event through the real agent (this triggers the SessionService event handlers)
    agent.emit('thread_event_added', { 
      event: approvalResponseEvent, 
      threadId: session.getId()
    });

    // Wait a moment for async processing
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify SSE broadcast was called for the approval response
    expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
      session.getId(),
      expect.objectContaining({
        type: 'TOOL_APPROVAL_RESPONSE',
        threadId: session.getId(),
        data: expect.objectContaining({
          toolCallId: 'tool-call-123',
          decision: 'approve'
        })
      })
    );
  });

  it('should handle TOOL_APPROVAL_REQUEST events (existing behavior)', async () => {
    // First, create a TOOL_CALL event so there's something to reference
    const { ThreadManager } = await import('@/lib/server/lace-imports');
    const threadManager = new ThreadManager();
    
    const toolCallEvent = threadManager.addEvent(asThreadId(session.getId()), 'TOOL_CALL', {
      id: 'tool-call-123',
      name: 'test-tool',
      arguments: { test: 'args' }
    });

    // Now create the TOOL_APPROVAL_REQUEST event
    const approvalRequestEvent = threadManager.addEvent(asThreadId(session.getId()), 'TOOL_APPROVAL_REQUEST', {
      toolCallId: 'tool-call-123'
    });

    // Emit the event through the real agent (this triggers the SessionService event handlers)
    agent.emit('thread_event_added', { 
      event: approvalRequestEvent, 
      threadId: session.getId()
    });

    // Wait a moment for async processing
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify SSE broadcast was called for the approval request
    expect(mockSSEManager.broadcast).toHaveBeenCalledWith(
      session.getId(),
      expect.objectContaining({
        type: 'TOOL_APPROVAL_REQUEST',
        threadId: session.getId(),
        data: expect.objectContaining({
          requestId: 'tool-call-123',
          toolName: 'test-tool'
        })
      })
    );
  });
});
