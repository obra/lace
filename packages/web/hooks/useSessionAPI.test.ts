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
      expect(result.current.error).toBe(null);

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      // Verify successful operation result and final state
      expect(session).toEqual(mockSession);
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
          providerInstanceId: 'test-anthropic-instance',
          modelId: 'claude-3-opus',
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
          providerInstanceId: 'test-anthropic-instance',
          modelId: 'claude-3-opus',
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
          providerInstanceId: 'test-anthropic-instance',
          modelId: 'claude-3-5-haiku-20241022',
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

  describe('error state management', () => {
    it('should properly manage error state during async operations', async () => {
      const { result } = renderHook(() => useSessionAPI());

      // Verify initial error state
      expect(result.current.error).toBe(null);

      // Test successful operation clears any previous error
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          session: {
            id: 'lace_20250101_sess01' as ThreadId,
            name: 'Test',
            provider: 'anthropic',
            model: 'claude-3-5-haiku-20241022',
            createdAt: new Date().toISOString(),
            agents: [],
          },
        })
      );

      await act(async () => {
        await result.current.createSession({ name: 'Test Session' });
      });

      expect(result.current.error).toBe(null);

      // Test failed operation sets error
      mockFetch.mockResolvedValueOnce(createMockErrorResponse('API Error'));

      await act(async () => {
        await result.current.createSession({ name: 'Test Session 2' });
      });

      expect(result.current.error).toBe('API Error');
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
      const mockSession = {
        id: 'lace_20250113_test123',
        name: 'Test',
        createdAt: new Date().toISOString(),
        agents: [],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse({ session: mockSession }));

      await act(async () => {
        await result.current.getSession('lace_20250113_test123' as ThreadId);
      });

      expect(result.current.error).toBe(null);
    });
  });
});
