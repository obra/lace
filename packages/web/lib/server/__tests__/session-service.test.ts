// ABOUTME: Unit tests for SessionService methods required by service layer refactoring
// ABOUTME: Tests the missing methods needed to eliminate direct business logic calls from API routes

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { asThreadId } from '@/lib/server/lace-imports';
import type { ThreadId } from '@/lib/server/lace-imports';

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

  describe('getProjectForSession', () => {
    it('should return project when session has projectId', async () => {
      // Arrange
      const mockProject = {
        getId: () => 'project-123',
        getConfiguration: vi.fn(() => ({ provider: 'anthropic' })),
      };
      const mockSession = {
        getId: () => mockSessionId,
        getProjectId: () => 'project-123',
      };

      const { Session, Project } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(mockSession);
      vi.mocked(Project.getById).mockReturnValue(mockProject);

      // Act
      const result = await sessionService.getProjectForSession(mockSessionId);

      // Assert
      expect(result).toBe(mockProject);
      expect(Session.getSession).toHaveBeenCalledWith(mockSessionId);
      expect(Project.getById).toHaveBeenCalledWith('project-123');
    });

    it('should return null when session has no projectId', async () => {
      // Arrange
      const mockSession = {
        getId: () => mockSessionId,
        getProjectId: () => null,
      };

      const { Session } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(mockSession);

      // Act
      const result = await sessionService.getProjectForSession(mockSessionId);

      // Assert
      expect(result).toBe(null);
      expect(Session.getSession).toHaveBeenCalledWith(mockSessionId);
    });

    it('should return null when session not found', async () => {
      // Arrange
      const { Session } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(null);

      // Act
      const result = await sessionService.getProjectForSession(mockSessionId);

      // Assert
      expect(result).toBe(null);
      expect(Session.getSession).toHaveBeenCalledWith(mockSessionId);
    });
  });

  describe('getEffectiveConfiguration', () => {
    it('should return merged project and session configuration', async () => {
      // Arrange
      const mockProject = {
        getConfiguration: vi.fn(() => ({
          provider: 'anthropic',
          maxTokens: 1000,
          toolPolicies: { bash: 'allow' },
        })),
      };
      const mockSession = {
        getId: () => mockSessionId,
        getProjectId: () => 'project-123',
        getConfiguration: vi.fn(() => ({
          model: 'claude-3-sonnet',
          maxTokens: 2000,
          toolPolicies: { 'file-read': 'require-approval' },
        })),
      };

      const { Session, Project } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(mockSession);
      vi.mocked(Project.getById).mockReturnValue(mockProject);

      // Act
      const result = await sessionService.getEffectiveConfiguration(mockSessionId);

      // Assert
      expect(result).toEqual({
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 2000,
        toolPolicies: {
          bash: 'allow',
          'file-read': 'require-approval',
        },
      });
    });

    it('should handle session with no project', async () => {
      // Arrange
      const mockSession = {
        getId: () => mockSessionId,
        getProjectId: () => null,
        getConfiguration: vi.fn(() => ({
          model: 'claude-3-sonnet',
          maxTokens: 2000,
        })),
      };

      const { Session } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(mockSession);

      // Act
      const result = await sessionService.getEffectiveConfiguration(mockSessionId);

      // Assert
      expect(result).toEqual({
        model: 'claude-3-sonnet',
        maxTokens: 2000,
      });
    });

    it('should throw error when session not found', async () => {
      // Arrange
      const { Session } = await import('@/lib/server/lace-imports');
      vi.mocked(Session.getSession).mockReturnValue(null);

      // Act & Assert
      await expect(sessionService.getEffectiveConfiguration(mockSessionId)).rejects.toThrow(
        'Session not found'
      );
    });
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
});
