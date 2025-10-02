// ABOUTME: Tests for useWorkspaceDetails hook
// ABOUTME: Validates workspace data fetching and state management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkspaceDetails } from '../useWorkspaceDetails';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('useWorkspaceDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null workspace data when sessionId is null', () => {
    const { result } = renderHook(() => useWorkspaceDetails(null));

    expect(result.current.workspaceMode).toBeNull();
    expect(result.current.workspaceInfo).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches workspace data on mount', async () => {
    const mockWorkspaceData = {
      mode: 'local' as const,
      info: {
        sessionId: 'test-session',
        state: 'running',
      },
    };

    vi.mocked(api.get).mockResolvedValue(mockWorkspaceData);

    const { result } = renderHook(() => useWorkspaceDetails('test-session'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaceMode).toBe('local');
    expect(result.current.workspaceInfo).toEqual(mockWorkspaceData.info);
    expect(result.current.error).toBeNull();
  });

  it('handles container mode workspace data', async () => {
    const mockWorkspaceData = {
      mode: 'container' as const,
      info: {
        containerId: 'workspace-abc123',
        branchName: 'feature/test',
        containerMountPath: '/workspace',
      },
    };

    vi.mocked(api.get).mockResolvedValue(mockWorkspaceData);

    const { result } = renderHook(() => useWorkspaceDetails('test-session'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaceMode).toBe('container');
    expect(result.current.workspaceInfo).toEqual(mockWorkspaceData.info);
  });

  it('handles null workspace info', async () => {
    const mockWorkspaceData = {
      mode: 'local' as const,
      info: null,
    };

    vi.mocked(api.get).mockResolvedValue(mockWorkspaceData);

    const { result } = renderHook(() => useWorkspaceDetails('test-session'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaceMode).toBe('local');
    expect(result.current.workspaceInfo).toBeNull();
  });

  it('handles fetch errors gracefully', async () => {
    const mockError = new Error('Failed to fetch workspace info');
    vi.mocked(api.get).mockRejectedValue(mockError);

    const { result } = renderHook(() => useWorkspaceDetails('test-session'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaceMode).toBeNull();
    expect(result.current.workspaceInfo).toBeNull();
    expect(result.current.error).toBe(mockError);
  });

  it('refetches when sessionId changes', async () => {
    const mockWorkspaceData1 = {
      mode: 'local' as const,
      info: { sessionId: 'session-1', state: 'running' },
    };
    const mockWorkspaceData2 = {
      mode: 'container' as const,
      info: { containerId: 'workspace-2', branchName: 'main' },
    };

    vi.mocked(api.get).mockResolvedValueOnce(mockWorkspaceData1);

    const { result, rerender } = renderHook(({ sessionId }) => useWorkspaceDetails(sessionId), {
      initialProps: { sessionId: 'session-1' },
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaceMode).toBe('local');

    // Change sessionId
    vi.mocked(api.get).mockResolvedValueOnce(mockWorkspaceData2);
    rerender({ sessionId: 'session-2' });

    await waitFor(() => {
      expect(result.current.workspaceMode).toBe('container');
    });
  });

  it('does not fetch when sessionId changes to null', async () => {
    const mockWorkspaceData = {
      mode: 'local' as const,
      info: { sessionId: 'session-1', state: 'running' },
    };

    vi.mocked(api.get).mockResolvedValueOnce(mockWorkspaceData);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string | null }) => useWorkspaceDetails(sessionId),
      {
        initialProps: { sessionId: 'session-1' as string | null },
      }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.get).toHaveBeenCalledTimes(1);

    // Change to null - should not fetch
    rerender({ sessionId: null });

    expect(result.current.workspaceMode).toBeNull();
    expect(result.current.workspaceInfo).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1); // Still only 1 call
  });

  it('provides reload function to refresh workspace data', async () => {
    const mockWorkspaceData1 = {
      mode: 'local' as const,
      info: { sessionId: 'test-session', state: 'running' },
    };
    const mockWorkspaceData2 = {
      mode: 'container' as const,
      info: { containerId: 'workspace-new', branchName: 'feature' },
    };

    vi.mocked(api.get)
      .mockResolvedValueOnce(mockWorkspaceData1)
      .mockResolvedValueOnce(mockWorkspaceData2);

    const { result } = renderHook(() => useWorkspaceDetails('test-session'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaceMode).toBe('local');

    // Reload
    await result.current.reload();

    await waitFor(() => {
      expect(result.current.workspaceMode).toBe('container');
    });

    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
