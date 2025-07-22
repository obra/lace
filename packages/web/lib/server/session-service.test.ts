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

// Mock Project.getById - external dependency for project validation
vi.mock('@/lib/server/lace-imports', async () => {
  const actual = await vi.importActual('@/lib/server/lace-imports');
  return {
    ...actual,
    Project: {
      getById: vi.fn((projectId: string) => ({ id: projectId, name: 'Test Project' })),
    },
  };
});

describe('SessionService Missing Methods', () => {
  let sessionService: ReturnType<typeof getSessionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionService = getSessionService();
    sessionService.clearActiveSessions();
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
  });

  describe('updateSession', () => {
    it('should update session metadata and persist changes', async () => {
      // Arrange: Create a session first
      const { Session } = await import('@/lib/server/lace-imports');
      const sessionId = asThreadId('test-session-id');

      // Create a session record in our mocked persistence
      const initialSessionData = {
        id: sessionId,
        name: 'Original Session',
        projectId: 'test-project',
        configuration: { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      Session.createSession(initialSessionData);

      const updates = { name: 'Updated Session', description: 'New description' };

      // Act: Update the session through the service
      sessionService.updateSession(sessionId, updates);

      // Assert: Verify the session was actually updated in persistence
      const updatedSession = Session.getSession(sessionId);
      expect(updatedSession).not.toBeNull();
      expect(updatedSession!.name).toBe('Updated Session');
      expect(updatedSession!.description).toBe('New description');
      expect(updatedSession!.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle partial updates correctly', async () => {
      // Arrange: Create a session with multiple properties
      const { Session } = await import('@/lib/server/lace-imports');
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
      Session.createSession(initialSessionData);

      // Act: Update only one property
      const partialUpdates = { description: 'Partially updated description' };
      sessionService.updateSession(sessionId, partialUpdates);

      // Assert: Verify only the specified field was updated
      const updatedSession = Session.getSession(sessionId);
      expect(updatedSession!.name).toBe('Original Session'); // unchanged
      expect(updatedSession!.description).toBe('Partially updated description'); // changed
      expect(updatedSession!.projectId).toBe('test-project'); // unchanged
    });
  });
});
