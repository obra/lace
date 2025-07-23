// ABOUTME: Unit tests for session management API endpoints
// ABOUTME: Tests session creation and listing functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/route';
import type { Session } from '@/types/api';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock only environment variables - avoid requiring real API keys in tests
vi.mock('~/config/env-loader', () => ({
  getEnvVar: vi.fn((key: string) => {
    const envVars: Record<string, string> = {
      ANTHROPIC_KEY: 'test-anthropic-key',
      OPENAI_API_KEY: 'test-openai-key',
    };
    return envVars[key] || '';
  }),
}));

// Using real SessionService with isolated temporary database
// Minimal mocking - only env vars. Tests validate real HTTP behavior

describe('Session API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up isolated test persistence
    setupTestPersistence();

    // ✅ ESSENTIAL MOCK - Console suppression to prevent test output noise and control log verification
    // These mocks are necessary for clean test output and error handling verification
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();

    // Clean up test persistence
    teardownTestPersistence();
  });

  // POST endpoint removed - sessions must be created through projects
  // Use POST /api/projects/{projectId}/sessions instead

  describe('GET /api/sessions', () => {
    it('should return empty array when no sessions exist', async () => {
      // Act: Call API with no sessions created
      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: unknown[] };

      // Assert: Empty array returned from real service
      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });

    it('should list all sessions', async () => {
      // Arrange: Create real project and sessions using real services
      const { Project } = await import('@/lib/server/lace-imports');
      const { getSessionService } = await import('@/lib/server/session-service');

      // Create and ensure project is saved
      const testProject = Project.create('Test Project', '/test', 'Test project for sessions');
      const projectId = testProject.getId();

      const sessionService = getSessionService();

      const session1 = await sessionService.createSession(
        'Test Session 1',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );

      const session2 = await sessionService.createSession(
        'Test Session 2',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );

      // Act: Call the API endpoint
      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: Session[] };

      // Assert: Verify real HTTP response with real data
      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(3); // 1 auto-created + 2 explicitly created

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

    it('should handle listing errors gracefully', async () => {
      // Arrange: Force a database error by corrupting the persistence layer
      const { getPersistence } = await import('~/persistence/database');

      // Override a persistence method to throw an error
      const _originalMethod = getPersistence().database;
      vi.spyOn(getPersistence(), 'database', 'get').mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

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
