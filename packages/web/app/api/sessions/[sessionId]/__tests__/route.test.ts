// ABOUTME: Unit tests for session detail API endpoint
// ABOUTME: Tests getting specific session information

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/[sessionId]/route';
import type { ThreadId, Session, Agent } from '@/types/api';
import type { SessionService } from '@/lib/server/session-service';
import type { AgentState } from '@/lib/server/lace-imports';
// Helper to create ThreadId safely for tests
const createThreadId = (id: string): ThreadId => id as ThreadId;

// Helper to create a mock Session instance with required methods
function createMockSession(props: {
  id: ThreadId;
  name?: string;
  createdAt?: Date;
  agents?: Agent[];
}) {
  const agents = props.agents || [];
  return {
    getId: () => props.id,
    getInfo: () => ({
      id: props.id,
      name: props.name || 'Test Session',
      createdAt: props.createdAt || new Date('2024-01-01T12:00:00Z'),
      provider: 'anthropic',
      model: 'claude-3-haiku',
      agents,
    }),
    getAgents: () => agents,
    getAgent: vi.fn(),
    getTaskManager: vi.fn(),
    spawnAgent: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    sendMessage: vi.fn(),
    destroy: vi.fn(),
  };
}

// Create a properly typed mock service
const mockSessionService: Pick<SessionService, 'getSession'> = {
  getSession: vi.fn(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Session Detail API Route', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('GET /api/sessions/[sessionId]', () => {
    it('should return session details with agents', async () => {
      const sessionId: ThreadId = createThreadId('lace_20240101_abcd1234');
      const mockAgents: Agent[] = [
        {
          threadId: createThreadId(`${sessionId}.1`),
          name: 'Agent 1',
          provider: 'anthropic',
          model: 'claude-3-opus',
          status: 'idle' as AgentState,
          createdAt: '2024-01-01T12:01:00Z',
        },
      ];

      const mockSession = createMockSession({
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date('2024-01-01T12:00:00Z'),
        agents: mockAgents,
      });

      vi.mocked(mockSessionService.getSession).mockResolvedValueOnce(mockSession);

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { session: Session };

      expect(response.status).toBe(200);
      expect(data.session).toEqual({
        id: sessionId,
        name: 'Test Session',
        createdAt: '2024-01-01T12:00:00.000Z',
        agents: mockAgents,
      });
      expect(mockSessionService.getSession).toHaveBeenCalledWith(sessionId);
    });

    it('should return 404 for non-existent session', async () => {
      const sessionId: ThreadId = createThreadId('non_existent');
      vi.mocked(mockSessionService.getSession).mockResolvedValueOnce(null);

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(data.error).toBe('Session not found');
    });

    it('should handle errors gracefully', async () => {
      const sessionId: ThreadId = createThreadId('lace_20240101_abcd1234');
      vi.mocked(mockSessionService.getSession).mockRejectedValueOnce(new Error('Database error'));

      const request = new NextRequest(`http://localhost:3005/api/sessions/${sessionId}`);
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: String(sessionId) }),
      });
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });
});
