// ABOUTME: Unit tests for session detail API endpoint
// ABOUTME: Tests getting specific session information using real functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/sessions/[sessionId]/route';
import type { Session } from '@/types/api';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '~/projects/project';
import { asThreadId } from '@/lib/server/core-types';

// ✅ ESSENTIAL MOCK - Next.js server-side module compatibility in test environment
// Required for Next.js framework compatibility during testing
vi.mock('server-only', () => ({}));

// ✅ ESSENTIAL MOCK - Provider registry to avoid real AI API calls during testing
// Prevents external network dependencies while testing API route behavior
vi.mock('~/providers/registry', () => ({
  ProviderRegistry: {
    createWithAutoDiscovery: vi.fn().mockReturnValue({
      createProvider: vi.fn().mockReturnValue({
        type: 'anthropic',
        model: 'claude-3-haiku-20240307',
        providerName: 'anthropic',
        defaultModel: 'claude-3-haiku-20240307',
        setSystemPrompt: vi.fn(),
        createResponse: vi.fn().mockResolvedValue({
          content: 'Mock response',
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        }),
        createStreamingResponse: vi.fn().mockReturnValue({
          *[Symbol.asyncIterator]() {
            yield { type: 'content', content: 'Mock streaming response' };
          },
        }),
      }),
    }),
  },
}));

// Mock tool implementations to avoid file system dependencies
vi.mock('~/tools/implementations/task-manager', () => ({
  createTaskManagerTools: vi.fn(() => []),
}));

vi.mock('~/tools/implementations/bash', () => ({
  BashTool: vi.fn(() => ({ name: 'bash' })),
}));

vi.mock('~/tools/implementations/file-read', () => ({
  FileReadTool: vi.fn(() => ({ name: 'file-read' })),
}));

vi.mock('~/tools/implementations/file-write', () => ({
  FileWriteTool: vi.fn(() => ({ name: 'file-write' })),
}));

vi.mock('~/tools/implementations/file-edit', () => ({
  FileEditTool: vi.fn(() => ({ name: 'file-edit' })),
}));

vi.mock('~/tools/implementations/file-insert', () => ({
  FileInsertTool: vi.fn(() => ({ name: 'file-insert' })),
}));

vi.mock('~/tools/implementations/file-list', () => ({
  FileListTool: vi.fn(() => ({ name: 'file-list' })),
}));

vi.mock('~/tools/implementations/ripgrep-search', () => ({
  RipgrepSearchTool: vi.fn(() => ({ name: 'ripgrep-search' })),
}));

vi.mock('~/tools/implementations/file-find', () => ({
  FileFindTool: vi.fn(() => ({ name: 'file-find' })),
}));

vi.mock('~/tools/implementations/delegate', () => ({
  DelegateTool: vi.fn(() => ({ name: 'delegate' })),
}));

vi.mock('~/tools/implementations/url-fetch', () => ({
  UrlFetchTool: vi.fn(() => ({ name: 'url-fetch' })),
}));

describe('Session Detail API Route', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Set up environment for session service
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    sessionService = getSessionService();

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    sessionService.clearActiveSessions();
    // Clear global singleton
    global.sessionService = undefined;
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    teardownTestPersistence();
  });

  describe('GET /api/sessions/[sessionId]', () => {
    it('should return session details with agents', async () => {
      // Create a test project first
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();

      // Create a real session using the session service
      const session = await sessionService.createSession(
        'Test Session',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      const sessionId = session.id;

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as { session: Session };
      expect(data.session).toEqual(
        expect.objectContaining({
          id: sessionId,
          name: 'Test Session',
          createdAt: expect.any(String) as string,
          agents: expect.arrayContaining([
            expect.objectContaining({
              threadId: sessionId,
              name: 'Test Session',
              provider: 'anthropic',
              model: 'claude-3-haiku-20240307',
              status: expect.any(String) as string,
            }),
          ]) as unknown[],
        })
      );
    });

    it('should return 400 for invalid session ID format', async () => {
      const sessionId = asThreadId('non_existent');

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should handle invalid session ID format gracefully', async () => {
      const sessionId = asThreadId('invalid_session_id');

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid session ID');
    });
  });

  describe('PATCH /api/sessions/[sessionId]', () => {
    it('should update session metadata', async () => {
      // Create a test project first
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();

      // Create a real session using the session service
      const session = await sessionService.createSession(
        'Original Session',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      const sessionId = session.id;

      const updates = {
        name: 'Updated Session Name',
        description: 'Updated description',
        status: 'archived',
      };

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });

      if (response.status !== 200) {
        const errorData = (await response.json()) as { error: string };
        console.error('PATCH failed with status:', response.status);
        console.error('Error data:', errorData);
        // Don't throw - let the test assertion handle the failure
      }
      expect(response.status).toBe(200);

      const data = (await response.json()) as { session: Session };
      expect(data.session).toEqual(
        expect.objectContaining({
          id: sessionId,
          name: 'Updated Session Name',
          description: 'Updated description',
          status: 'archived',
        })
      );
    });

    it('should return 400 for invalid session ID format', async () => {
      const sessionId = asThreadId('non_existent');

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });

      const data = (await response.json()) as { error: string };
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should validate request data', async () => {
      // Create a test project first
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();

      // Create a real session using the session service
      const session = await sessionService.createSession(
        'Test Session',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      const sessionId = session.id;

      const invalidUpdates = {
        name: '', // Empty name should be invalid
        status: 'invalid-status', // Invalid status should be invalid
      };

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(invalidUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });

      const data = (await response.json()) as { error: string; details?: unknown };
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(data.details).toBeDefined();
    });

    it('should handle partial updates', async () => {
      // Create a test project first
      const testProject = Project.create(
        'Test Project',
        '/test/path',
        'Test project for API test',
        {}
      );
      const projectId = testProject.getId();

      // Create a real session using the session service
      const session = await sessionService.createSession(
        'Original Session',
        'anthropic',
        'claude-3-haiku-20240307',
        projectId
      );
      const sessionId = session.id;

      // Only update name, leaving description and status unchanged
      const partialUpdates = {
        name: 'Partially Updated Session',
      };

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(partialUpdates),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as { session: Session };
      expect(data.session).toEqual(
        expect.objectContaining({
          id: sessionId,
          name: 'Partially Updated Session',
        })
      );
    });

    it('should handle invalid session ID format in updates', async () => {
      const sessionId = asThreadId('invalid_session_id');

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });

      const data = (await response.json()) as { error: string };
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid session ID');
    });
  });

  describe('TDD: Direct Session Data Access', () => {
    it('should return session data when session exists', async () => {
      // This test verifies that PATCH route uses Session.getSession() directly
      // instead of going through sessionService.getSessionData()

      // Mock the Session class directly
      const { Session } = await import('@/lib/server/lace-imports');
      const mockDirectSessionData = {
        id: 'test-session',
        name: 'Updated Session',
        description: 'Updated description',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        projectId: 'test-project',
        configuration: { provider: 'anthropic' },
      };

      // This should spy on the core Session.getSession() method being called directly
      const sessionGetSpy = vi
        .spyOn(Session, 'getSession')
        .mockReturnValue(mockDirectSessionData as never);

      // Create a real session first for the route to work with
      const testProject = Project.create('TDD Test Project', '/test/path', 'TDD test project', {});
      const session = await sessionService.createSession(
        'Test Session',
        'anthropic',
        'claude-3-haiku-20240307',
        testProject.getId()
      );

      const request = new NextRequest(`http://localhost:3005/api/sessions/${session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Session' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // This should FAIL initially because route still uses sessionService.getSessionData
      await PATCH(request, {
        params: Promise.resolve({ sessionId: session.id }),
      });

      // Verify Session.getSession was called directly (not through sessionService.getSessionData)
      expect(sessionGetSpy).toHaveBeenCalledWith(session.id);

      sessionGetSpy.mockRestore();
    });
  });
});
