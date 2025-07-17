// ABOUTME: Unit tests for session management API endpoints
// ABOUTME: Tests session creation and listing functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/sessions/route';
import type { Session } from '@/types/api';
import type { SessionService } from '@/lib/server/session-service';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';
// Helper function for tests to avoid server-only imports
function createThreadId(id: string) {
  return id as import('@/types/api').ThreadId;
}

// Create the properly typed mock service
const mockSessionService = {
  createSession: vi.fn<SessionService['createSession']>(),
  listSessions: vi.fn<SessionService['listSessions']>(),
  getSession: vi.fn<SessionService['getSession']>(),
  spawnAgent: vi.fn<SessionService['spawnAgent']>(),
  getAgent: vi.fn<SessionService['getAgent']>(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Session API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    teardownTestPersistence();
  });

  describe('POST /api/sessions', () => {
    it('should create a new session with provided name', async () => {
      const sessionName = 'Test Session';
      const mockSession: Partial<Session> = {
        id: createThreadId('lace_20240101_abcd12'),
        name: sessionName,
        createdAt: '2024-01-01T12:00:00Z',
        agents: [],
      };

      void mockSessionService.createSession.mockResolvedValueOnce(mockSession);

      const request = new NextRequest('http://localhost:3005/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName,
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { session: typeof mockSession };

      expect(response.status).toBe(201);
      expect(data.session).toEqual(mockSession);
      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        sessionName,
        'anthropic',
        'claude-3-haiku-20240307'
      );
    });

    it('should create session with default name when name not provided', async () => {
      const mockSession: Partial<Session> = {
        id: createThreadId('lace_20240101_abcd12'),
        name: 'Untitled Session',
        createdAt: '2024-01-01T12:00:00Z',
        agents: [],
      };

      void mockSessionService.createSession.mockResolvedValueOnce(mockSession);

      const request = new NextRequest('http://localhost:3005/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { session: typeof mockSession };

      expect(response.status).toBe(201);
      expect(data.session.name).toBe('Untitled Session');
      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        undefined,
        'anthropic',
        'claude-3-haiku-20240307'
      );
    });

    it('should handle session creation errors', async () => {
      void mockSessionService.createSession.mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest('http://localhost:3005/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Session',
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
        }),
      });

      const response = await POST(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('GET /api/sessions', () => {
    it('should list all sessions', async () => {
      const mockSessions: Partial<Session>[] = [
        {
          id: createThreadId('lace_20240101_abcd12'),
          name: 'Session 1',
          createdAt: '2024-01-01T12:00:00Z',
          agents: [],
        },
        {
          id: createThreadId('lace_20240101_efgh56'),
          name: 'Session 2',
          createdAt: '2024-01-01T13:00:00Z',
          agents: [
            {
              threadId: createThreadId('lace_20240101_efgh56.1'),
              name: 'Agent 1',
              provider: 'anthropic',
              model: 'claude-3-opus',
              status: 'idle' as const,
              createdAt: '2024-01-01T13:01:00Z',
            },
          ],
        },
      ];

      void mockSessionService.listSessions.mockResolvedValueOnce(mockSessions);

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: typeof mockSessions };

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual(mockSessions);
      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });

    it('should return empty array when no sessions exist', async () => {
      void mockSessionService.listSessions.mockResolvedValueOnce([]);

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: unknown[] };

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });

    it('should handle listing errors', async () => {
      void mockSessionService.listSessions.mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
