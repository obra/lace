// ABOUTME: Tests for useReleaseNotes hook functionality with simplified approach
// ABOUTME: Tests hook behavior with different user settings scenarios using real implementation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReleaseNotes } from './useReleaseNotes';

// Mock fetch globally like other tests do
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock parseResponse
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn(),
}));

describe('useReleaseNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default successful response for API calls
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
  });

  it('should show modal when release notes are newer than last seen', async () => {
    const { result } = renderHook(() =>
      useReleaseNotes({ lastSeenReleaseNotesHash: 'old-hash-different' })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(true);
    expect(result.current.content).toContain('# Release Notes');
  });

  it('should handle missing user settings', async () => {
    const { result } = renderHook(() => useReleaseNotes(undefined));

    // When userSettings is undefined, hook should finish loading without checking
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(false);
  });

  it('should show modal when user has never seen release notes', async () => {
    const { result } = renderHook(() => useReleaseNotes({}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(true);
    expect(result.current.content).toContain('# Release Notes');
  });
});
