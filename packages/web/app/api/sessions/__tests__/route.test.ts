// ABOUTME: Unit tests for session management API endpoints
// ABOUTME: Tests session creation and listing functionality

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';
import type { ThreadId } from '@/types/api';

// Create the mock service outside so we can access it
const mockSessionService = {
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  spawnAgent: vi.fn(),
  getAgent: vi.fn(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Session API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/sessions', () => {
    it('should create a new session with provided name', async () => {
      const sessionName = 'Test Session';
      const mockSession = {
        id: 'lace_20240101_abcd1234' as ThreadId,
        name: sessionName,
        createdAt: '2024-01-01T12:00:00Z',
        agents: [],
      };

      mockSessionService.createSession.mockResolvedValueOnce(mockSession);

      const request = new NextRequest('http://localhost:3005/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.session).toEqual(mockSession);
      expect(mockSessionService.createSession).toHaveBeenCalledWith(sessionName);
    });

    it('should create session with default name when name not provided', async () => {
      const mockSession = {
        id: 'lace_20240101_abcd1234' as ThreadId,
        name: 'Untitled Session',
        createdAt: '2024-01-01T12:00:00Z',
        agents: [],
      };

      mockSessionService.createSession.mockResolvedValueOnce(mockSession);

      const request = new NextRequest('http://localhost:3005/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.session.name).toBe('Untitled Session');
      expect(mockSessionService.createSession).toHaveBeenCalledWith(undefined);
    });

    it('should handle session creation errors', async () => {
      mockSessionService.createSession.mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest('http://localhost:3005/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Session' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });

  describe('GET /api/sessions', () => {
    it('should list all sessions', async () => {
      const mockSessions = [
        {
          id: 'lace_20240101_abcd1234' as ThreadId,
          name: 'Session 1',
          createdAt: '2024-01-01T12:00:00Z',
          agents: [],
        },
        {
          id: 'lace_20240101_efgh5678' as ThreadId,
          name: 'Session 2',
          createdAt: '2024-01-01T13:00:00Z',
          agents: [
            {
              threadId: 'lace_20240101_efgh5678.1' as ThreadId,
              name: 'Agent 1',
              provider: 'anthropic',
              model: 'claude-3-opus',
              status: 'idle' as const,
              createdAt: '2024-01-01T13:01:00Z',
            },
          ],
        },
      ];

      mockSessionService.listSessions.mockResolvedValueOnce(mockSessions);

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual(mockSessions);
      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });

    it('should return empty array when no sessions exist', async () => {
      mockSessionService.listSessions.mockResolvedValueOnce([]);

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });

    it('should handle listing errors', async () => {
      mockSessionService.listSessions.mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest('http://localhost:3005/api/sessions');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });
});
