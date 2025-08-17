// ABOUTME: Tests for useProjectManagement hook
// ABOUTME: Validates project loading, selection, and CRUD operations

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo } from '@/types/core';
import { useProjectManagement } from './useProjectManagement';

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

const mockProjects: ProjectInfo[] = [
  {
    id: 'project-1',
    name: 'Test Project 1',
    description: 'A test project',
    workingDirectory: '/test1',
    isArchived: false,
    createdAt: new Date('2024-01-01'),
    lastUsedAt: new Date('2024-01-01'),
    sessionCount: 5,
  },
  {
    id: 'project-2',
    name: 'Test Project 2',
    description: 'Another test project',
    workingDirectory: '/test2',
    isArchived: true,
    createdAt: new Date('2024-01-02'),
    lastUsedAt: new Date('2024-01-02'),
    sessionCount: 2,
  },
];

describe('useProjectManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads projects on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockProjects),
    });

    const { result } = renderHook(() => useProjectManagement());

    expect(result.current.loading).toBe(true);
    expect(result.current.projects).toEqual([]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toEqual(mockProjects);
    expect(mockFetch).toHaveBeenCalledWith('/api/projects', { method: 'GET' });
  });

  it('handles loading errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const networkError = new Error('Network error');
    mockFetch.mockRejectedValueOnce(networkError);

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toEqual([]);
    expect(result.current.error).toBe('Network error');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to load projects:', networkError);

    consoleSpy.mockRestore();
  });

  it('updates a project', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([{ ...mockProjects[0], name: 'Updated Project' }, mockProjects[1]]),
      });

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await result.current.updateProject('project-1', { name: 'Updated Project' });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/projects/project-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Project' }),
    });
  });

  it('reloads projects after update', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.updateProject('project-1', { name: 'Updated' });
    });

    // Should call fetch 3 times: initial load, update, reload
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('handles update project errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })
      .mockRejectedValueOnce(new Error('Update failed'));

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await result.current.updateProject('project-1', { name: 'Updated Project' });
    });

    expect(result.current.error).toBe('Update failed');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to update project:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles update project HTTP errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await result.current.updateProject('project-1', { name: 'Updated Project' });
    });

    expect(result.current.error).toBe('HTTP 404: undefined');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to update project:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles create project errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })
      .mockRejectedValueOnce(new Error('Create failed'));

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await expect(
        result.current.createProject({
          name: 'New Project',
          workingDirectory: '/new',
        })
      ).rejects.toThrow('Create failed');
    });

    expect(result.current.error).toBe('Create failed');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to create project:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('handles load project configuration errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })
      .mockRejectedValueOnce(new Error('Config load failed'));

    const { result } = renderHook(() => useProjectManagement());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    let config: Record<string, unknown>;
    await act(async () => {
      config = await result.current.loadProjectConfiguration('project-1');
    });

    expect(config!).toEqual({});
    expect(result.current.error).toBe('Config load failed');
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load project configuration:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
