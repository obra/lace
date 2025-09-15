// ABOUTME: Tests for release notes service functionality
// ABOUTME: Covers release notes status checking and settings integration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkReleaseNotesStatus, markReleaseNotesAsSeen } from './release-notes-service';

// Mock the generated release notes metadata
vi.mock('@/app/generated/release-notes-meta.json', () => ({
  default: {
    hash: 'test-hash-123',
    content: '# Test Release Notes\n\nTest content',
    generatedAt: '2024-01-01T00:00:00.000Z',
  },
}));

// Mock fetch for markReleaseNotesAsSeen
const mockFetch = vi.fn();
global.fetch = mockFetch;

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

      expect(result).toEqual({
        shouldShow: true,
        content: '# Test Release Notes\n\nTest content',
        currentHash: 'test-hash-123',
      });
    });

    it('should indicate release notes should be shown when hash differs', async () => {
      const result = await checkReleaseNotesStatus('different-hash');

      expect(result).toEqual({
        shouldShow: true,
        content: '# Test Release Notes\n\nTest content',
        currentHash: 'test-hash-123',
      });
    });

    it('should indicate release notes should not be shown when hash matches', async () => {
      const result = await checkReleaseNotesStatus('test-hash-123');

      expect(result).toEqual({
        shouldShow: false,
        content: '# Test Release Notes\n\nTest content',
        currentHash: 'test-hash-123',
      });
    });
  });

  describe('markReleaseNotesAsSeen', () => {
    it('should send PATCH request to update settings', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await markReleaseNotesAsSeen('test-hash-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lastSeenReleaseNotesHash: 'test-hash-123',
        }),
      });
    });

    it('should handle failed API requests gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(markReleaseNotesAsSeen('test-hash-123')).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to update release notes seen status:',
        'Internal Server Error'
      );

      consoleSpy.mockRestore();
    });

    it('should handle network errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValue(networkError);

      await expect(markReleaseNotesAsSeen('test-hash-123')).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to update release notes seen status:',
        networkError
      );

      consoleSpy.mockRestore();
    });
  });
});
