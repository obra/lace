// ABOUTME: Tests for useSessionManagement hook
// ABOUTME: Validates session loading, creation, and selection operations

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo, ThreadId } from '@/types/core';
import { useSessionManagement } from './useSessionManagement';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock parseResponse
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn(),
}));

import { parseResponse } from '@/lib/serialization';
const mockParseResponse = vi.mocked(parseResponse);

const mockSessions: SessionInfo[] = [
  {
    id: 'session-1' as ThreadId,
    name: 'Test Session 1',
    createdAt: new Date('2024-01-01'),
    agents: [
      {
        threadId: 'agent-1' as ThreadId,
        name: 'Agent 1',
        modelId: 'claude-3-5-haiku',
        status: 'idle',
        providerInstanceId: 'provider-1',
      },
    ],
  },
  {
    id: 'session-2' as ThreadId,
    name: 'Test Session 2',
    createdAt: new Date('2024-01-02'),
    agents: [],
  },
];

describe('useSessionManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default parseResponse behavior - just call res.json()
    mockParseResponse.mockImplementation((res: Response) => res.json());
  });

  it('loads sessions when project is selected', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessions)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response);

    mockParseResponse
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce({ configuration: {} });

    const { result, rerender } = renderHook(
      (props: { projectId: string | null }) => useSessionManagement(props.projectId),
      {
        initialProps: { projectId: null as string | null },
      }
    );

    // Initially no sessions when no project
    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);

    // Select a project
    rerender({ projectId: 'project-1' });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessions).toEqual(mockSessions);
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/sessions', { method: 'GET' });
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/configuration', {
      method: 'GET',
    });
  });

  it('clears sessions when project is deselected', async () => {
    const { result, rerender } = renderHook(
      (props: { projectId: string | null }) => useSessionManagement(props.projectId),
      {
        initialProps: { projectId: null as string | null },
      }
    );

    // Initially no sessions when no project
    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);

    // Select a project - set up mocks for this
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessions)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response);

    mockParseResponse
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce({ configuration: {} });

    await act(async () => {
      rerender({ projectId: 'project-1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessions).toEqual(mockSessions);

    // Deselect project
    act(() => {
      rerender({ projectId: null });
    });

    expect(result.current.sessions).toEqual([]);
  });

  it('creates a new session', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessions)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 'new-session' })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([...mockSessions, { id: 'new-session', name: 'New Session' }])
          ),
        clone: function () {
          return this;
        },
      } as Response);

    mockParseResponse
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce({ configuration: {} })
      .mockResolvedValueOnce({ id: 'new-session' })
      .mockResolvedValueOnce([...mockSessions, { id: 'new-session', name: 'New Session' }]);

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await result.current.createSession({
        name: 'New Session',
        description: 'A new session',
      });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Session',
        description: 'A new session',
      }),
    });

    // Should call: initial sessions load, initial config load, create session, reload sessions after creation
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('loads session configuration', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([])),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: { theme: 'dark' } })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: { theme: 'dark' } })),
        clone: function () {
          return this;
        },
      } as Response);

    mockParseResponse
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ configuration: { theme: 'dark' } })
      .mockResolvedValueOnce({ configuration: { theme: 'dark' } });

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Call loadProjectConfig explicitly to test it
    await act(async () => {
      await result.current.loadProjectConfig();
    });

    expect(result.current.projectConfig).toEqual({ theme: 'dark' });
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/configuration', {
      method: 'GET',
    });
  });

  it('handles API errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const networkError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(networkError).mockRejectedValueOnce(networkError);

    // parseResponse won't be called for network errors, no need to mock

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load sessions:', expect.any(Error));
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load project configuration:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('handles create session errors by throwing them', async () => {
    const createError = new Error('Create failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessions)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockRejectedValueOnce(createError);

    mockParseResponse
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce({ configuration: {} });
    // Third call will be rejected, so no parseResponse call

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Expect the error to be thrown
    await expect(
      act(async () => {
        await result.current.createSession({
          name: 'New Session',
          description: 'A new session',
        });
      })
    ).rejects.toThrow('Create failed');
  });

  it('handles create session HTTP errors by throwing them', async () => {
    const errorResponse = {
      ok: false,
      text: () => Promise.resolve(JSON.stringify({ error: 'Session creation failed' })),
      clone: function () {
        return this;
      },
    } as Response;

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockSessions)),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce(errorResponse);

    // For the error response, parseResponse should return the parsed error data
    mockParseResponse
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce({ configuration: {} })
      .mockResolvedValueOnce({ error: 'Session creation failed' });

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Expect the error to be thrown
    await expect(
      act(async () => {
        await result.current.createSession({
          name: 'New Session',
          description: 'A new session',
        });
      })
    ).rejects.toThrow();
  });

  it('handles load session configuration errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const configError = new Error('Config load failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([])),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockRejectedValueOnce(configError);

    mockParseResponse.mockResolvedValueOnce([]).mockResolvedValueOnce({ configuration: {} });

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(result.current.loadSessionConfiguration('session-1')).rejects.toThrow(
        'Config load failed'
      );
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error loading session configuration:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('handles update session configuration errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateError = new Error('Update config failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([])),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockRejectedValueOnce(updateError);

    mockParseResponse.mockResolvedValueOnce([]).mockResolvedValueOnce({ configuration: {} });

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(
        result.current.updateSessionConfiguration('session-1', { theme: 'dark' })
      ).rejects.toThrow('Update config failed');
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error updating session configuration:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('handles update session errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateError = new Error('Update session failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([])),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockRejectedValueOnce(updateError);

    mockParseResponse.mockResolvedValueOnce([]).mockResolvedValueOnce({ configuration: {} });

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(
        result.current.updateSession('session-1', { name: 'Updated Session' })
      ).rejects.toThrow('Update session failed');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Error updating session:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles load sessions for project errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadError = new Error('Load sessions failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([])),
        clone: function () {
          return this;
        },
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ configuration: {} })),
        clone: function () {
          return this;
        },
      } as Response)
      .mockRejectedValueOnce(loadError);

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    let sessions: SessionInfo[];
    await act(async () => {
      sessions = await result.current.loadSessionsForProject('other-project');
    });

    expect(sessions!).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load sessions for project:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
