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
  parseResponse: vi.fn((res) => {
    if (!res.ok) throw new Error('Network error');
    return res.json();
  }),
}));

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
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useSessionManagement('project-1'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
