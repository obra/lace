// ABOUTME: Unit tests for session management API endpoints
// ABOUTME: Tests session creation and listing functionality

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/route';
import type { Session } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';
import type { SessionService } from '@/lib/server/session-service';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Test data factory functions
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: asThreadId('lace_20240101_abcd12'),
    name: 'Test Session',
    createdAt: '2024-01-01T12:00:00Z',
    agents: [],
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<Session['agents'][0]> = {}): Session['agents'][0] {
  return {
    threadId: asThreadId('lace_20240101_abcd12.1'),
    name: 'Test Agent',
    provider: 'anthropic',
    model: 'claude-3-opus',
    status: 'idle' as const,
    createdAt: '2024-01-01T12:00:00Z',
    ...overrides,
  };
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

  // POST endpoint removed - sessions must be created through projects
  // Use POST /api/projects/{projectId}/sessions instead

  describe('GET /api/sessions', () => {
    it('should list all sessions', async () => {
      const mockSessions: Session[] = [
        createMockSession({
          id: asThreadId('lace_20240101_abcd12'),
          name: 'Session 1',
          createdAt: '2024-01-01T12:00:00Z',
        }),
        createMockSession({
          id: asThreadId('lace_20240101_efgh56'),
          name: 'Session 2',
          createdAt: '2024-01-01T13:00:00Z',
          agents: [
            createMockAgent({
              threadId: asThreadId('lace_20240101_efgh56.1'),
              name: 'Agent 1',
              createdAt: '2024-01-01T13:01:00Z',
            }),
          ],
        }),
      ];

      mockSessionService.listSessions.mockResolvedValueOnce(mockSessions);

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: typeof mockSessions };

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual(mockSessions);
      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });

    it('should return empty array when no sessions exist', async () => {
      mockSessionService.listSessions.mockResolvedValueOnce([]);

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { sessions: unknown[] };

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });

    it('should handle listing errors', async () => {
      mockSessionService.listSessions.mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
