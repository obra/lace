// ABOUTME: Unit tests for useAvailableTools hook
// ABOUTME: Tests tool loading, error handling, and race condition prevention

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAvailableTools } from './useAvailableTools';

// Mock the ProjectProvider
const mockLoadProjectConfiguration = vi.fn();
const mockProjects = [
  { id: 'project-1', name: 'Test Project' },
  { id: 'project-2', name: 'Another Project' },
];

vi.mock('@/components/providers/ProjectProvider', () => ({
  useProjectContext: () => ({
    projects: mockProjects,
    loadProjectConfiguration: mockLoadProjectConfiguration,
  }),
}));

describe('useAvailableTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should start with loading state', () => {
    mockLoadProjectConfiguration.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useAvailableTools());

    expect(result.current.loading).toBe(true);
    expect(result.current.availableTools).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should load tools from project configuration', async () => {
    const mockConfig = {
      availableTools: ['bash', 'file_read', 'file_write'],
    };
    mockLoadProjectConfiguration.mockResolvedValue(mockConfig);

    const { result } = renderHook(() => useAvailableTools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.availableTools).toEqual(['bash', 'file_read', 'file_write']);
    expect(result.current.error).toBeNull();
    expect(mockLoadProjectConfiguration).toHaveBeenCalledWith('project-1');
  });

  it('should handle empty projects array', async () => {
    vi.mocked(require('@/components/providers/ProjectProvider').useProjectContext).mockReturnValue({
      projects: [],
      loadProjectConfiguration: mockLoadProjectConfiguration,
    });

    const { result } = renderHook(() => useAvailableTools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.availableTools).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(mockLoadProjectConfiguration).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Network error';
    mockLoadProjectConfiguration.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useAvailableTools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.availableTools).toEqual([]);
    expect(result.current.error).toBe(errorMessage);
  });

  it('should handle missing availableTools in config', async () => {
    const mockConfig = {}; // No availableTools field
    mockLoadProjectConfiguration.mockResolvedValue(mockConfig);

    const { result } = renderHook(() => useAvailableTools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.availableTools).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should handle non-Error exceptions', async () => {
    mockLoadProjectConfiguration.mockRejectedValue('String error');

    const { result } = renderHook(() => useAvailableTools());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.availableTools).toEqual([]);
    expect(result.current.error).toBe('Failed to load available tools');
  });

  it('should prevent race conditions on unmount', async () => {
    let resolvePromise!: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockLoadProjectConfiguration.mockReturnValue(promise);

    const { result, unmount } = renderHook(() => useAvailableTools());

    expect(result.current.loading).toBe(true);

    // Unmount before promise resolves
    unmount();

    // Resolve the promise after unmount
    resolvePromise({ availableTools: ['bash'] });

    // Wait a bit to ensure any state updates would have occurred
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The hook should not have updated state after unmount
    // (We can't directly test this, but no errors should be thrown)
  });

  it('should reload when projects change', async () => {
    const mockConfig1 = { availableTools: ['bash'] };
    const mockConfig2 = { availableTools: ['file_read'] };

    mockLoadProjectConfiguration
      .mockResolvedValueOnce(mockConfig1)
      .mockResolvedValueOnce(mockConfig2);

    const { result, rerender } = renderHook(
      ({ projects }) => {
        vi.mocked(
          require('@/components/providers/ProjectProvider').useProjectContext
        ).mockReturnValue({
          projects,
          loadProjectConfiguration: mockLoadProjectConfiguration,
        });
        return useAvailableTools();
      },
      { initialProps: { projects: [{ id: 'project-1' }] } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.availableTools).toEqual(['bash']);

    // Change projects
    rerender({ projects: [{ id: 'project-2' }] });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.availableTools).toEqual(['file_read']);
    expect(mockLoadProjectConfiguration).toHaveBeenCalledTimes(2);
  });
});
