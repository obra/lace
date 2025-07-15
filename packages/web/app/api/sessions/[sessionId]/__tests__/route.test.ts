// ABOUTME: Unit tests for session detail API endpoint
// ABOUTME: Tests getting specific session information

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/[sessionId]/route';
import type { ThreadId, Session } from '@/types/api';
import type { SessionService } from '@/lib/server/session-service';
import type { AgentState } from '@/lib/server/lace-imports';
// Helper to create ThreadId safely for tests
const createThreadId = (id: string): ThreadId => id as ThreadId;

// Create a properly typed mock service
const mockSessionService: Pick<SessionService, 'getSession'> = {
  getSession: vi.fn(),
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
      const sessionId: ThreadId = createThreadId('lace_20240101_abcd1234');
      const mockSession: Session = {
        id: sessionId,
        name: 'Test Session',
        createdAt: '2024-01-01T12:00:00Z',
        agents: [
          {
            threadId: createThreadId(`${sessionId}.1`),
            name: 'Agent 1',
            provider: 'anthropic',
            model: 'claude-3-opus',
            status: 'idle' as AgentState,
            createdAt: '2024-01-01T12:01:00Z',
          },
        ],
      };

      vi.mocked(mockSessionService.getSession).mockResolvedValueOnce(mockSession);

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, { params: Promise.resolve({ sessionId: String(sessionId) }) });
      const data = (await response.json()) as { session: Session };

      expect(response.status).toBe(200);
      expect(data.session).toEqual(mockSession);
      expect(mockSessionService.getSession).toHaveBeenCalledWith(sessionId);
    });

    it('should return 404 for non-existent session', async () => {
      const sessionId: ThreadId = createThreadId('non_existent');
      vi.mocked(mockSessionService.getSession).mockResolvedValueOnce(null);

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, { params: Promise.resolve({ sessionId: String(sessionId) }) });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should handle errors gracefully', async () => {
      const sessionId: ThreadId = createThreadId('lace_20240101_abcd1234');
      vi.mocked(mockSessionService.getSession).mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, { params: Promise.resolve({ sessionId: String(sessionId) }) });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
