// ABOUTME: Tests for release notes service functionality
// ABOUTME: Covers release notes status checking and settings integration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkReleaseNotesStatus, markReleaseNotesAsSeen } from './release-notes-service';
import { api } from '@/lib/api-client';

// Mock the api client
vi.mock('@/lib/api-client', () => ({
  api: {
    patch: vi.fn(),
  },
}));

describe('release-notes-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkReleaseNotesStatus', () => {
    it('should indicate release notes should be shown when no last seen hash', async () => {
      const result = await checkReleaseNotesStatus();

      expect(result.shouldShow).toBe(true);
      expect(result.content).toContain('# Release Notes');
      expect(result.currentHash).toBeTruthy();
    });

    it('should indicate release notes should be shown when hash differs', async () => {
      const result = await checkReleaseNotesStatus('different-hash');

      expect(result.shouldShow).toBe(true);
      expect(result.content).toContain('# Release Notes');
      expect(result.currentHash).toBeTruthy();
    });

    it('should indicate release notes should not be shown when hash matches', async () => {
      // First get the current hash
      const firstResult = await checkReleaseNotesStatus();

      // Then check with the same hash
      const result = await checkReleaseNotesStatus(firstResult.currentHash);

      expect(result.shouldShow).toBe(false);
      expect(result.content).toContain('# Release Notes');
      expect(result.currentHash).toBe(firstResult.currentHash);
    });
  });

  describe('markReleaseNotesAsSeen', () => {
    it('should send PATCH request to update settings', async () => {
      const mockPatch = vi.mocked(api.patch);
      mockPatch.mockResolvedValue({});

      await markReleaseNotesAsSeen('test-hash-123');

      expect(mockPatch).toHaveBeenCalledWith('/api/settings', {
        lastSeenReleaseNotesHash: 'test-hash-123',
      });
    });

    it('should handle failed API requests gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockPatch = vi.mocked(api.patch);
      const apiError = new Error('Internal Server Error');
      mockPatch.mockRejectedValue(apiError);

      await expect(markReleaseNotesAsSeen('test-hash-123')).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to update release notes seen status:',
        apiError
      );

      consoleSpy.mockRestore();
    });

    it('should handle network errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockPatch = vi.mocked(api.patch);
      const networkError = new Error('Network error');
      mockPatch.mockRejectedValue(networkError);

      await expect(markReleaseNotesAsSeen('test-hash-123')).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to update release notes seen status:',
        networkError
      );

      consoleSpy.mockRestore();
    });
  });
});
