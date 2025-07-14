// ABOUTME: Tests for useSessionAPI hook
// ABOUTME: Verifies session and agent management API calls

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import type { ThreadId } from '@/types/api';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('useSessionAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('createSession', () => {
    it('should create a session successfully', async () => {
      const mockSession = {
        id: 'lace_20250113_test123' as ThreadId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ session: mockSession }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      expect(session).toEqual(mockSession);
      expect(global.fetch).toHaveBeenCalledWith('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Session' }),
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should handle session creation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to create session' }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      expect(session).toBe(null);
      expect(result.current.error).toBe('Failed to create session');
      expect(result.current.loading).toBe(false);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.createSession({ name: 'Test Session' });
      });

      expect(session).toBe(null);
      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should list sessions successfully', async () => {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: mockSessions }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let sessions;
      await act(async () => {
        sessions = await result.current.listSessions();
      });

      expect(sessions).toEqual(mockSessions);
      expect(global.fetch).toHaveBeenCalledWith('/api/sessions');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to list sessions' }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let sessions;
      await act(async () => {
        sessions = await result.current.listSessions();
      });

      expect(sessions).toEqual([]);
      expect(result.current.error).toBe('Failed to list sessions');
    });
  });

  describe('getSession', () => {
    it('should get session details successfully', async () => {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ session: mockSession }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.getSession(sessionId);
      });

      expect(session).toEqual(mockSession);
      expect(global.fetch).toHaveBeenCalledWith(`/api/sessions/${sessionId}`);
    });

    it('should return null for non-existent session', async () => {
      const sessionId = 'invalid' as ThreadId;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Session not found' }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let session;
      await act(async () => {
        session = await result.current.getSession(sessionId);
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agent: mockAgent }),
      });

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
      expect(global.fetch).toHaveBeenCalledWith(`/api/sessions/${sessionId}/agents`, {
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

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to spawn agent' }),
      });

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agents: mockAgents }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let agents;
      await act(async () => {
        agents = await result.current.listAgents(sessionId);
      });

      expect(agents).toEqual(mockAgents);
      expect(global.fetch).toHaveBeenCalledWith(`/api/sessions/${sessionId}/agents`);
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const threadId = 'lace_20250113_test123.1' as ThreadId;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'accepted',
          threadId,
          messageId: 'msg123',
        }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let success;
      await act(async () => {
        success = await result.current.sendMessage(threadId, 'Hello, assistant!');
      });

      expect(success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(`/api/threads/${threadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, assistant!' }),
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should handle message send errors', async () => {
      const threadId = 'lace_20250113_test123.1' as ThreadId;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to send message' }),
      });

      const { result } = renderHook(() => useSessionAPI());

      let success;
      await act(async () => {
        success = await result.current.sendMessage(threadId, 'Hello');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Failed to send message');
    });
  });

  describe('loading state', () => {
    it('should set loading state during operations', async () => {
      const mockSession = {
        id: 'lace_20250113_test123' as ThreadId,
        name: 'Test Session',
        createdAt: new Date().toISOString(),
        agents: [],
      };

      let resolvePromise: (value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useSessionAPI());

      expect(result.current.loading).toBe(false);

      // Start operation
      act(() => {
        void result.current.createSession({ name: 'Test Session' });
      });

      expect(result.current.loading).toBe(true);

      // Resolve operation
      await act(async () => {
        resolvePromise!({
          ok: true,
          json: async () => ({ session: mockSession }),
        });
        await promise;
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });
});
