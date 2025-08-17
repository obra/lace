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
        json: () => Promise.resolve(mockSessions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      });

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
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/sessions');
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/configuration');
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
        json: () => Promise.resolve(mockSessions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      });

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
        json: () => Promise.resolve(mockSessions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'new-session' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([...mockSessions, { id: 'new-session', name: 'New Session' }]),
      });

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
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: { theme: 'dark' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: { theme: 'dark' } }),
      });

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Call loadProjectConfig explicitly to test it
    await act(async () => {
      await result.current.loadProjectConfig();
    });

    expect(result.current.projectConfig).toEqual({ theme: 'dark' });
    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1/configuration');
  });

  it('handles API errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const networkError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(networkError).mockRejectedValueOnce(networkError);

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load sessions:', networkError);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load project configuration:', networkError);

    consoleSpy.mockRestore();
  });

  it('handles create session errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const createError = new Error('Create failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
      .mockRejectedValueOnce(createError);

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

    expect(consoleSpy).toHaveBeenCalledWith('Failed to create session:', createError);

    consoleSpy.mockRestore();
  });

  it('handles create session HTTP errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errorResponse = {
      ok: false,
      json: () => Promise.resolve({ error: 'Session creation failed' }),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
      .mockResolvedValueOnce(errorResponse);

    // For the error response, parseResponse should return the parsed error data
    mockParseResponse
      .mockImplementationOnce((res: Response) => res.json())
      .mockImplementationOnce((res: Response) => res.json())
      .mockImplementationOnce((res: Response) => res.json());

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

    expect(consoleSpy).toHaveBeenCalledWith('Failed to create session:', 'Session creation failed');

    consoleSpy.mockRestore();
  });

  it('handles load session configuration errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const configError = new Error('Config load failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
      .mockRejectedValueOnce(configError);

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(result.current.loadSessionConfiguration('session-1')).rejects.toThrow(
        'Config load failed'
      );
    });

    expect(consoleSpy).toHaveBeenCalledWith('Error loading session configuration:', configError);

    consoleSpy.mockRestore();
  });

  it('handles update session configuration errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateError = new Error('Update config failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
      .mockRejectedValueOnce(updateError);

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(
        result.current.updateSessionConfiguration('session-1', { theme: 'dark' })
      ).rejects.toThrow('Update config failed');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Error updating session configuration:', updateError);

    consoleSpy.mockRestore();
  });

  it('handles update session errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateError = new Error('Update session failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
      .mockRejectedValueOnce(updateError);

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(
        result.current.updateSession('session-1', { name: 'Updated Session' })
      ).rejects.toThrow('Update session failed');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Error updating session:', updateError);

    consoleSpy.mockRestore();
  });

  it('handles load sessions for project errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadError = new Error('Load sessions failed');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configuration: {} }),
      })
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
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load sessions for project:', loadError);

    consoleSpy.mockRestore();
  });
});
