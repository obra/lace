// ABOUTME: Tests for conversation history API endpoint
// ABOUTME: Tests loading conversation history from database for session restoration

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sessions/[sessionId]/history/route';
import { Session } from '@/lib/server/lace-imports';
import type { SessionEvent, ApiErrorResponse } from '@/types/api';

interface HistoryResponse {
  events: SessionEvent[];
}

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock session service
const mockSessionService = {
  getSession: vi.fn(),
};

vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

// Mock Agent
const mockAgent = {
  getMainAndDelegateEvents: vi.fn(),
};

// Mock Session
const mockSession = {
  getAgent: vi.fn(),
};

vi.mock('@/lib/server/lace-imports', () => ({
  Session: {
    getById: vi.fn(),
  },
}));

describe('Session History API', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    process.env.LACE_DB_PATH = ':memory:';

    // Reset mock implementations
    mockSessionService.getSession.mockReset();
    vi.mocked(Session.getById).mockReset();
    mockSession.getAgent.mockReset();
    mockAgent.getMainAndDelegateEvents.mockReset();
  });

  afterEach(() => {
    delete process.env.LACE_DB_PATH;
  });

  describe('GET /api/sessions/[sessionId]/history', () => {
    it('should return conversation history for valid session', async () => {
      // Mock session exists
      mockSessionService.getSession.mockResolvedValue({
        id: 'lace_20240101_test1',
        name: 'Test Session',
        agents: [],
      });

      // Mock Session.getById returns a session with coordinator agent
      mockSession.getAgent.mockReturnValue(mockAgent);
      vi.mocked(Session.getById).mockResolvedValue(mockSession);

      // Mock conversation history
      const mockThreadEvents = [
        {
          id: 'event1',
          threadId: 'lace_20240101_test1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          data: 'Hello, world!',
        },
        {
          id: 'event2',
          threadId: 'lace_20240101_test1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T12:00:01Z'),
          data: 'Hello! How can I help you?',
        },
      ];

      mockAgent.getMainAndDelegateEvents.mockReturnValue(mockThreadEvents);

      const request = new NextRequest('http://localhost/api/sessions/lace_20240101_test1/history');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'lace_20240101_test1' }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as HistoryResponse;

      expect(data.events).toHaveLength(2);
      expect(data.events[0]).toEqual({
        threadId: 'lace_20240101_test1',
        timestamp: '2024-01-01T12:00:00.000Z',
        type: 'USER_MESSAGE',
        data: { content: 'Hello, world!' },
      });
      expect(data.events[1]).toEqual({
        threadId: 'lace_20240101_test1',
        timestamp: '2024-01-01T12:00:01.000Z',
        type: 'AGENT_MESSAGE',
        data: { content: 'Hello! How can I help you?' },
      });
    });

    it('should handle tool call events', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'lace_20240101_test1',
        name: 'Test Session',
        agents: [],
      });

      mockSession.getAgent.mockReturnValue(mockAgent);
      vi.mocked(Session.getById).mockResolvedValue(mockSession);

      const mockThreadEvents = [
        {
          id: 'event1',
          threadId: 'lace_20240101_test1',
          type: 'TOOL_CALL',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          data: {
            toolName: 'file-read',
            input: { path: '/test.txt' },
          },
        },
        {
          id: 'event2',
          threadId: 'lace_20240101_test1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T12:00:01Z'),
          data: {
            toolName: 'file-read',
            result: 'File content here',
          },
        },
      ];

      mockAgent.getMainAndDelegateEvents.mockReturnValue(mockThreadEvents);

      const request = new NextRequest('http://localhost/api/sessions/lace_20240101_test1/history');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'lace_20240101_test1' }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as HistoryResponse;

      expect(data.events).toHaveLength(2);
      expect(data.events[0]).toEqual({
        threadId: 'lace_20240101_test1',
        timestamp: '2024-01-01T12:00:00.000Z',
        type: 'TOOL_CALL',
        data: {
          toolName: 'file-read',
          input: { path: '/test.txt' },
        },
      });
      expect(data.events[1]).toEqual({
        threadId: 'lace_20240101_test1',
        timestamp: '2024-01-01T12:00:01.000Z',
        type: 'TOOL_RESULT',
        data: {
          toolName: 'file-read',
          result: 'File content here',
        },
      });
    });

    it('should return 404 for non-existent session', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      const request = new NextRequest(
        'http://localhost/api/sessions/lace_20240101_notfound/history'
      );
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'lace_20240101_notfound' }),
      });

      expect(response.status).toBe(404);
      const data = (await response.json()) as ApiErrorResponse;
      expect(data.error).toBe('Session not found');
    });

    it('should return 400 for invalid session ID format', async () => {
      const request = new NextRequest('http://localhost/api/sessions/invalid-format/history');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'invalid-format' }),
      });

      expect(response.status).toBe(400);
      const data = (await response.json()) as ApiErrorResponse;
      expect(data.error).toBe('Invalid session ID format');
    });

    it('should return empty array when no history exists', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'lace_20240101_test1',
        name: 'Test Session',
        agents: [],
      });

      mockSession.getAgent.mockReturnValue(mockAgent);
      vi.mocked(Session.getById).mockResolvedValue(mockSession);
      mockAgent.getMainAndDelegateEvents.mockReturnValue([]);

      const request = new NextRequest('http://localhost/api/sessions/lace_20240101_test1/history');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'lace_20240101_test1' }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as HistoryResponse;
      expect(data.events).toEqual([]);
    });

    it('should handle unknown event types gracefully', async () => {
      mockSessionService.getSession.mockResolvedValue({
        id: 'lace_20240101_test1',
        name: 'Test Session',
        agents: [],
      });

      mockSession.getAgent.mockReturnValue(mockAgent);
      vi.mocked(Session.getById).mockResolvedValue(mockSession);

      const mockThreadEvents = [
        {
          id: 'event1',
          threadId: 'lace_20240101_test1',
          type: 'UNKNOWN_EVENT_TYPE',
          timestamp: new Date('2024-01-01T12:00:00Z'),
          data: 'Some data',
        },
      ];

      mockAgent.getMainAndDelegateEvents.mockReturnValue(mockThreadEvents);

      const request = new NextRequest('http://localhost/api/sessions/lace_20240101_test1/history');
      const response = await GET(request, {
        params: Promise.resolve({ sessionId: 'lace_20240101_test1' }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as HistoryResponse;

      expect(data.events).toHaveLength(1);
      expect(data.events[0]).toEqual({
        threadId: 'lace_20240101_test1',
        timestamp: '2024-01-01T12:00:00.000Z',
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { message: 'Unknown event: UNKNOWN_EVENT_TYPE' },
      });
    });
  });
});
