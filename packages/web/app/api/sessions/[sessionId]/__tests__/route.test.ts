// ABOUTME: Unit tests for session detail API endpoint
// ABOUTME: Tests getting specific session information using real functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/[sessionId]/route';
import type { ThreadId, Session } from '@/types/api';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';
import { getSessionService } from '@/lib/server/session-service';
import { Project } from '~/projects/project';

// Helper to create ThreadId safely for tests
const createThreadId = (id: string): ThreadId => id as ThreadId;

// Mock external dependencies to avoid real API calls
vi.mock('server-only', () => ({}));

// Mock provider to avoid real API calls
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
          async *[Symbol.asyncIterator]() {
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
      const sessionId = session.id as ThreadId;

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

    it('should return 404 for non-existent session', async () => {
      const sessionId: ThreadId = createThreadId('non_existent');

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should handle errors gracefully', async () => {
      const sessionId: ThreadId = createThreadId('invalid_session_id');

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });
  });
});
