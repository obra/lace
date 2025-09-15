// ABOUTME: Tests for useReleaseNotes hook functionality
// ABOUTME: Covers hook behavior with different user settings scenarios

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReleaseNotes } from './useReleaseNotes';
import * as releaseNotesService from '@/lib/services/release-notes-service';

// Mock the release notes service
vi.mock('@/lib/services/release-notes-service', () => ({
  checkReleaseNotesStatus: vi.fn(),
  markReleaseNotesAsSeen: vi.fn(),
}));

const mockCheckReleaseNotesStatus = vi.mocked(releaseNotesService.checkReleaseNotesStatus);
const mockMarkReleaseNotesAsSeen = vi.mocked(releaseNotesService.markReleaseNotesAsSeen);

describe('useReleaseNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show modal when release notes are newer', async () => {
    mockCheckReleaseNotesStatus.mockResolvedValue({
      shouldShow: true,
      content: 'Test content',
      currentHash: 'new-hash',
    });

    const { result } = renderHook(() => useReleaseNotes({ lastSeenReleaseNotesHash: 'old-hash' }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(true);
    expect(result.current.content).toBe('Test content');
  });

  it('should not show modal when release notes are already seen', async () => {
    mockCheckReleaseNotesStatus.mockResolvedValue({
      shouldShow: false,
      content: 'Test content',
      currentHash: 'same-hash',
    });

    const { result } = renderHook(() => useReleaseNotes({ lastSeenReleaseNotesHash: 'same-hash' }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(false);
    expect(result.current.content).toBe('Test content');
  });

  it('should handle missing user settings', async () => {
    mockCheckReleaseNotesStatus.mockResolvedValue({
      shouldShow: true,
      content: 'Test content',
      currentHash: 'new-hash',
    });

    const { result } = renderHook(() => useReleaseNotes(undefined));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCheckReleaseNotesStatus).toHaveBeenCalledWith(undefined);
    expect(result.current.shouldShowModal).toBe(true);
  });

  it('should call markReleaseNotesAsSeen when handleMarkAsSeen is called', async () => {
    mockCheckReleaseNotesStatus.mockResolvedValue({
      shouldShow: true,
      content: 'Test content',
      currentHash: 'test-hash',
    });
    mockMarkReleaseNotesAsSeen.mockResolvedValue();

    const { result } = renderHook(() => useReleaseNotes({}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await result.current.handleMarkAsSeen();

    expect(mockMarkReleaseNotesAsSeen).toHaveBeenCalledWith('test-hash');
  });

  it('should dismiss modal when dismissModal is called', async () => {
    mockCheckReleaseNotesStatus.mockResolvedValue({
      shouldShow: true,
      content: 'Test content',
      currentHash: 'test-hash',
    });

    const { result } = renderHook(() => useReleaseNotes({}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(true);

    result.current.dismissModal();

    expect(result.current.shouldShowModal).toBe(false);
  });

  it('should handle service errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCheckReleaseNotesStatus.mockRejectedValue(new Error('Service error'));

    const { result } = renderHook(() => useReleaseNotes({}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.shouldShowModal).toBe(false);
    expect(result.current.content).toBe('');
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to check release notes status:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
