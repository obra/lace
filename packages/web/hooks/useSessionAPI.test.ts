// ABOUTME: Tests for useSessionAPI hook focusing on state management and behavior
// ABOUTME: Verifies loading states, error handling, and hook behavior patterns

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import type { ThreadId } from '@/types/core';
import { createMockResponse, createMockErrorResponse } from '@/test-utils/mock-fetch';

// ✅ ESSENTIAL MOCK - Mock fetch to avoid network calls in tests
// Tests focus on hook state management behavior, not API implementation
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('useSessionAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('createSession', () => {
    it('should manage loading and success states during session creation', async () => {
      const mockSession = {
        id: 'lace_20250113_test123' as ThreadId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse({ session: mockSession }));

      const { result } = renderHook(() => useSessionAPI());

      // Verify initial state
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      // Verify successful operation result and final state
      expect(session).toEqual(mockSession);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should handle error states and return null on failure', async () => {
      mockFetch.mockResolvedValueOnce(createMockErrorResponse('Failed to create session'));

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      // Verify error handling behavior
      expect(session).toBe(null);
      expect(result.current.error).toBe('Failed to create session');
      expect(result.current.loading).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      // Verify network error handling behavior
      expect(session).toBe(null);
      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should return session list and manage loading states', async () => {
      const mockSessions = [
        {
          id: 'lace_20250113_test123' as ThreadId,
          name: 'Session 1',
          createdAt: new Date().toISOString(),
          agents: [],
        },
        {
          id: 'lace_20250113_test456' as ThreadId,
          name: 'Session 2',
          createdAt: new Date().toISOString(),
          agents: [],
        },
      ];

      mockFetch.mockResolvedValueOnce(createMockResponse({ sessions: mockSessions }));

      const { result } = renderHook(() => useSessionAPI());

      let sessions;
      await act(async () => {
        sessions = await result.current.listSessions();
      });

      // Verify successful operation result and final state
      expect(sessions).toEqual(mockSessions);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should return empty array and set error state on failure', async () => {
      mockFetch.mockResolvedValueOnce(createMockErrorResponse('Failed to list sessions'));

      const { result } = renderHook(() => useSessionAPI());

      let sessions;
      await act(async () => {
        sessions = await result.current.listSessions();
      });

      // Verify error handling behavior
      expect(sessions).toEqual([]);
      expect(result.current.error).toBe('Failed to list sessions');
    });
  });

  describe('getSession', () => {
    it('should return session details when found', async () => {
      const sessionId = 'lace_20250113_test123' as ThreadId;
      const mockSession = {
        id: sessionId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [
          {
            threadId: `${sessionId}.1` as ThreadId,
            name: 'pm',
            provider: 'anthropic',
            model: 'claude-3-haiku',
            status: 'idle' as const,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(createMockResponse({ session: mockSession }));

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.getSession(sessionId);
      });

      // Verify successful operation result
      expect(session).toEqual(mockSession);
    });

    it('should return null for non-existent session', async () => {
      const sessionId = 'invalid' as ThreadId;

      mockFetch.mockResolvedValueOnce(createMockErrorResponse('Session not found'));

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.getSession(sessionId);
      });

      // Verify error handling behavior
      expect(session).toBe(null);
      expect(result.current.error).toBe('Session not found');
    });
  });

  describe('spawnAgent', () => {
    it('should spawn agent successfully', async () => {
      const sessionId = 'lace_20250113_test123' as ThreadId;
      const mockAgent = {
        threadId: `${sessionId}.1` as ThreadId,
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-opus',
        status: 'idle' as const,
        createdAt: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce(createMockResponse({ agent: mockAgent }));

      const { result } = renderHook(() => useSessionAPI());

      let agent;
      await act(async () => {
        agent = await result.current.spawnAgent(sessionId, {
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus',
        });
      });

      expect(agent).toEqual(mockAgent);
      // Verify correct agent creation request was made
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe(`/api/sessions/${sessionId}/agents`);
      expect(fetchCall[1]).toEqual({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus',
        }),
      });
    });

    it('should handle agent spawn errors', async () => {
      const sessionId = 'lace_20250113_test123' as ThreadId;

      mockFetch.mockResolvedValueOnce(createMockErrorResponse('Failed to spawn agent'));

      const { result } = renderHook(() => useSessionAPI());

      let agent;
      await act(async () => {
        agent = await result.current.spawnAgent(sessionId, {
          name: 'test',
        });
      });

      expect(agent).toBe(null);
      expect(result.current.error).toBe('Failed to spawn agent');
    });
  });

  describe('listAgents', () => {
    it('should list agents successfully', async () => {
      const sessionId = 'lace_20250113_test123' as ThreadId;
      const mockAgents = [
        {
          threadId: `${sessionId}.1` as ThreadId,
          name: 'pm',
          provider: 'anthropic',
          model: 'claude-3-haiku',
          status: 'idle' as const,
          createdAt: new Date().toISOString(),
        },
        {
          threadId: `${sessionId}.2` as ThreadId,
          name: 'architect',
          provider: 'anthropic',
          model: 'claude-3-opus',
          status: 'thinking' as const,
          createdAt: new Date().toISOString(),
        },
      ];

      mockFetch.mockResolvedValueOnce(createMockResponse({ agents: mockAgents }));

      const { result } = renderHook(() => useSessionAPI());

      let agents;
      await act(async () => {
        agents = await result.current.listAgents(sessionId);
      });

      expect(agents).toEqual(mockAgents);
      // Verify agents list request was made correctly
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const requestUrl = fetchMock.mock.calls[0][0] as string;
      expect(requestUrl).toBe(`/api/sessions/${sessionId}/agents`);
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const threadId = 'lace_20250113_test123.1' as ThreadId;

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'accepted',
          threadId,
          messageId: 'msg123',
        })
      );

      const { result } = renderHook(() => useSessionAPI());

      let success;
      await act(async () => {
        success = await result.current.sendMessage(threadId, 'Hello, assistant!');
      });

      expect(success).toBe(true);
      // Verify message sending request was made correctly
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe(`/api/threads/${threadId}/message`);
      expect(fetchCall[1]).toEqual({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, assistant!' }),
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should handle message send errors', async () => {
      const threadId = 'lace_20250113_test123.1' as ThreadId;

      mockFetch.mockResolvedValueOnce(createMockErrorResponse('Failed to send message'));

      const { result } = renderHook(() => useSessionAPI());

      let success;
      await act(async () => {
        success = await result.current.sendMessage(threadId, 'Hello');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Failed to send message');
    });
  });

  describe('loading state management', () => {
    it('should properly manage loading state lifecycle during async operations', async () => {
      const mockSession = {
        id: 'lace_20250113_test123' as ThreadId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [],
      };

      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useSessionAPI());

      // Verify initial loading state
      expect(result.current.loading).toBe(false);

      // Start async operation
      act(() => {
        void result.current.createSession({ name: 'Test Session' });
      });

      // Verify loading state is set during operation
      expect(result.current.loading).toBe(true);

      // Resolve the async operation
      await act(async () => {
        resolvePromise!(createMockResponse({ session: mockSession }));
        await promise;
      });

      // Verify loading state is cleared after completion
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should clear error state when starting new operations', async () => {
      const { result } = renderHook(() => useSessionAPI());

      // First operation fails
      mockFetch.mockResolvedValueOnce(createMockErrorResponse('First error'));

      await act(async () => {
        await result.current.createSession({ name: 'Test Session' });
      });

      expect(result.current.error).toBe('First error');

      // Second operation succeeds - error should be cleared
      mockFetch.mockResolvedValueOnce(createMockResponse({ sessions: [] }));

      await act(async () => {
        await result.current.listSessions();
      });

      expect(result.current.error).toBe(null);
    });
  });
});
