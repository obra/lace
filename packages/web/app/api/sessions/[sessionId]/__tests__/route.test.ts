// ABOUTME: Unit tests for session detail API endpoint
// ABOUTME: Tests getting specific session information

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '~/app/api/sessions/[sessionId]/route';
import type { ThreadId } from '@/types/api';

// Create the mock service outside so we can access it
const mockSessionService = {
  createSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  spawnAgent: vi.fn(),
  getAgent: vi.fn(),
  sendMessage: vi.fn(),
  handleAgentEvent: vi.fn(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Session Detail API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/sessions/[sessionId]', () => {
    it('should return session details with agents', async () => {
      const sessionId = 'lace_20240101_abcd1234' as ThreadId;
      const mockSession = {
        id: sessionId,
        name: 'Test Session',
        createdAt: '2024-01-01T12:00:00Z',
        agents: [
          {
            threadId: `${sessionId}.1` as ThreadId,
            name: 'Agent 1',
            provider: 'anthropic',
            model: 'claude-3-opus',
            status: 'idle' as const,
            createdAt: '2024-01-01T12:01:00Z',
          },
        ],
      };

      mockSessionService.getSession.mockResolvedValueOnce(mockSession);

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.session).toEqual(mockSession);
      expect(mockSessionService.getSession).toHaveBeenCalledWith(sessionId);
    });

    it('should return 404 for non-existent session', async () => {
      const sessionId = 'non_existent' as ThreadId;
      mockSessionService.getSession.mockResolvedValueOnce(null);

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should handle errors gracefully', async () => {
      const sessionId = 'lace_20240101_abcd1234' as ThreadId;
      mockSessionService.getSession.mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });
});
