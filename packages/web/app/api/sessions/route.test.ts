// ABOUTME: Unit tests for session management API endpoints
// ABOUTME: Tests session creation and listing functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/route';
import type { Session } from '@/types/api';

// Mock external dependencies (database persistence) but not business logic
const projectStore = new Map<string, any>();
const sessionStore = new Map<string, any>();

vi.mock('~/persistence/database', () => {
  return {
    getPersistence: vi.fn(() => ({
      // Project persistence methods
      loadAllProjects: vi.fn(() => {
        return Array.from(projectStore.values());
      }),
      loadProject: vi.fn((projectId: string) => {
        return projectStore.get(projectId) || null;
      }),
      saveProject: vi.fn((project: any) => {
        projectStore.set(project.id, project);
      }),
      loadSessionsByProject: vi.fn((projectId: string) => {
        return Array.from(sessionStore.values()).filter((s) => s.projectId === projectId);
      }),

      // Session persistence methods
      loadAllSessions: vi.fn(() => {
        return Array.from(sessionStore.values());
      }),
      loadSession: vi.fn((sessionId: string) => {
        return sessionStore.get(sessionId) || null;
      }),
      saveSession: vi.fn((session: any) => {
        sessionStore.set(session.id, session);
      }),

      // Thread persistence methods (needed for session functionality)
      loadThreadEvents: vi.fn(() => []),
      saveThreadEvents: vi.fn(),
      deleteThread: vi.fn(),
    })),
  };
});

// Mock ThreadManager for session management - external dependency
vi.mock('~/threads/thread-manager', () => ({
  ThreadManager: vi.fn(() => ({
    getSessionsForProject: vi.fn(() => []), // Empty array for clean tests
  })),
}));

// Now using real SessionService for proper integration testing
// No more mocking of business logic - tests validate real HTTP behavior

describe('Session API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the in-memory stores between tests
    projectStore.clear();
    sessionStore.clear();

    // ✅ ESSENTIAL MOCK - Console suppression to prevent test output noise and control log verification
    // These mocks are necessary for clean test output and error handling verification
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // POST endpoint removed - sessions must be created through projects
  // Use POST /api/projects/{projectId}/sessions instead

  describe('GET /api/sessions', () => {
    it('should list all sessions', async () => {
      // Arrange: Create real project and sessions using real services
      const { Project } = await import('@/lib/server/lace-imports');
      const { getSessionService } = await import('@/lib/server/session-service');

      // Create and ensure project is saved
      const testProject = Project.create('Test Project', '/test', 'Test project for sessions');

      // Verify project was saved to our mocked store
      expect(projectStore.has(testProject.id)).toBe(true);

      const sessionService = getSessionService();

      const session1 = await sessionService.createSession(
        'Test Session 1',
        'anthropic',
        'claude-3-haiku-20240307',
        testProject.id
      );

      const session2 = await sessionService.createSession(
        'Test Session 2',
        'anthropic',
        'claude-3-haiku-20240307',
        testProject.id
      );

      // Act: Call the API endpoint
      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: Session[] };

      // Assert: Verify real HTTP response with real data
      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(2);

      // Find sessions by name since IDs are generated
      const returnedSession1 = data.sessions.find((s) => s.name === 'Test Session 1');
      const returnedSession2 = data.sessions.find((s) => s.name === 'Test Session 2');

      expect(returnedSession1).toBeDefined();
      expect(returnedSession1).toMatchObject({
        name: 'Test Session 1',
        id: session1.id,
        createdAt: session1.createdAt,
      });

      expect(returnedSession2).toBeDefined();
      expect(returnedSession2).toMatchObject({
        name: 'Test Session 2',
        id: session2.id,
        createdAt: session2.createdAt,
      });
    });

    it('should return empty array when no sessions exist', async () => {
      // Act: Call API with no sessions created
      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: unknown[] };

      // Assert: Empty array returned from real service
      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });

    it('should handle listing errors gracefully', async () => {
      // Arrange: Force a database error by corrupting the persistence layer
      const mockPersistence = {
        loadAllSessions: vi.fn(() => {
          throw new Error('Database connection failed');
        }),
        loadAllProjects: vi.fn(() => []),
        loadProject: vi.fn(() => null),
        saveProject: vi.fn(),
        saveSession: vi.fn(),
        loadSession: vi.fn(() => null),
        loadThreadEvents: vi.fn(() => []),
        saveThreadEvents: vi.fn(),
        deleteThread: vi.fn(),
        loadSessionsByProject: vi.fn(() => []),
      };

      // Override the persistence mock for this test only
      const { getPersistence } = await import('~/persistence/database');
      vi.mocked(getPersistence).mockReturnValueOnce(mockPersistence as any);

      // Act: Call the API when service fails
      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      // Assert: API handles the persistence error gracefully
      expect(response.status).toBe(500);
      expect(data.error).toBe('Database connection failed');
    });
  });
});
