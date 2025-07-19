// ABOUTME: Unit tests for SessionService methods required by service layer refactoring
// ABOUTME: Tests the missing methods needed to eliminate direct business logic calls from API routes

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/lace-imports';

describe('SessionService after getProjectForSession removal', () => {
  it('should not have getProjectForSession method', () => {
    const sessionService = new SessionService();

    // This test should FAIL initially because method still exists
    expect((sessionService as any).getProjectForSession).toBeUndefined();
  });
});

describe('SessionService after getEffectiveConfiguration removal', () => {
  it('should not have getEffectiveConfiguration method', () => {
    const sessionService = new SessionService();

    // This test should FAIL initially because method still exists
    expect((sessionService as any).getEffectiveConfiguration).toBeUndefined();
  });
});

// Mock the lace imports
vi.mock('@/lib/server/lace-imports', async () => {
  const actual = await vi.importActual('@/lib/server/lace-imports');
  return {
    ...actual,
    Session: {
      createWithDefaults: vi.fn(),
      getAll: vi.fn(),
      getSession: vi.fn(),
      updateSession: vi.fn(),
    },
    Project: {
      getById: vi.fn(),
    },
  };
});

// Mock persistence
vi.mock('~/persistence/database', () => ({
  getPersistence: vi.fn(() => ({
    updateSession: vi.fn(),
  })),
}));

describe('SessionService Missing Methods', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let mockSessionId: ThreadId;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionService = getSessionService();
    sessionService.clearActiveSessions();
    mockSessionId = asThreadId('test-session-id');
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
  });

  describe('updateSessionConfiguration', () => {
    it('should update session configuration', async () => {
      // Arrange
      const mockSession = {
        getId: () => mockSessionId,
        getConfiguration: vi.fn(() => ({
          provider: 'anthropic',
          maxTokens: 1000,
        })),
      };

      const { Session } = await import('@/lib/server/lace-imports');
      const { getPersistence } = await import('~/persistence/database');
      const mockPersistence = { updateSession: vi.fn() } as {
        updateSession: ReturnType<typeof vi.fn>;
      };

      vi.mocked(Session.getSession).mockReturnValue(mockSession);
      vi.mocked(getPersistence).mockReturnValue(mockPersistence);

      const configUpdate = { model: 'claude-3-opus', maxTokens: 2000 };

      // Act
      await sessionService.updateSessionConfiguration(mockSessionId, configUpdate);

      // Assert
      expect(mockPersistence.updateSession).toHaveBeenCalledWith(
        mockSessionId,
        expect.objectContaining({
          configuration: {
            provider: 'anthropic',
            maxTokens: 2000,
            model: 'claude-3-opus',
          },
          updatedAt: expect.any(Date) as Date,
        })
      );
    });

    it('should throw error when session not found', async () => {
      // Arrange
      const { Session } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(null);

      // Act & Assert
      await expect(
        sessionService.updateSessionConfiguration(mockSessionId, { model: 'claude-3-opus' })
      ).rejects.toThrow('Session not found');
    });
  });

  describe('updateSession', () => {
    it('should update session metadata', async () => {
      // Arrange
      const { Session } = await import('@/lib/server/lace-imports');
      const mockUpdateSession = vi.mocked(Session.updateSession);

      const updates = { name: 'Updated Session' };

      // Act
      sessionService.updateSession(mockSessionId, updates);

      // Assert
      expect(mockUpdateSession).toHaveBeenCalledWith(mockSessionId, updates);
    });
  });

  describe('getSessionData', () => {
    it('should get fresh session data directly from database', async () => {
      // Arrange
      const { Session } = await import('@/lib/server/lace-imports');
      const mockSessionData = {
        id: mockSessionId,
        name: 'Test Session',
        description: 'Test description',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        configuration: { model: 'claude-3-haiku' },
        projectId: 'test-project',
      };
      vi.mocked(Session.getSession).mockReturnValue(mockSessionData);

      // Act
      const result = await sessionService.getSessionData(mockSessionId);

      // Assert
      expect(result).toEqual(mockSessionData);
      expect(Session.getSession).toHaveBeenCalledWith(mockSessionId);
    });

    it('should return null when session not found', async () => {
      // Arrange
      const { Session } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(null);

      // Act
      const result = await sessionService.getSessionData(mockSessionId);

      // Assert
      expect(result).toBeNull();
      expect(Session.getSession).toHaveBeenCalledWith(mockSessionId);
    });
  });
});
