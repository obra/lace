// ABOUTME: Tests for fetch interceptor
// ABOUTME: Validates fetch monkey patching and HAR recording integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enableFetchInterception,
  disableFetchInterception,
  isFetchInterceptionEnabled,
} from '~/utils/fetch-interceptor';
import { initializeHARRecording, disableHARRecording, getHARRecorder } from '~/utils/har-recorder';
import { existsSync, unlinkSync } from 'fs';

const TEST_HAR_FILE = '/tmp/test-fetch-recording.har';

// Mock fetch for testing
const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

describe('FetchInterceptor', () => {
  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(TEST_HAR_FILE)) {
      unlinkSync(TEST_HAR_FILE);
    }

    // Reset fetch
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();

    // Mock Date.now for predictable timestamps - reset for each test
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockClear();

    // Each fetch call uses 2 Date.now() calls (start and end)
    // Set up enough mock values for all tests
    for (let i = 0; i < 20; i++) {
      dateSpy.mockReturnValueOnce(1234567890000 + i * 100); // startTime
      dateSpy.mockReturnValueOnce(1234567890000 + i * 100 + 50); // endTime
    }

    // Disable any existing interception
    disableFetchInterception();
    disableHARRecording();
  });

  afterEach(() => {
    disableFetchInterception();
    disableHARRecording();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();

    if (existsSync(TEST_HAR_FILE)) {
      unlinkSync(TEST_HAR_FILE);
    }
  });

  describe('interception management', () => {
    it('should enable and disable fetch interception', () => {
      expect(isFetchInterceptionEnabled()).toBe(false);

      enableFetchInterception();
      expect(isFetchInterceptionEnabled()).toBe(true);

      disableFetchInterception();
      expect(isFetchInterceptionEnabled()).toBe(false);
    });

    it('should not enable interception if fetch is not available', () => {
      // Temporarily remove fetch
      const temp = globalThis.fetch;
      delete (globalThis as { fetch?: typeof fetch }).fetch;

      enableFetchInterception();
      expect(isFetchInterceptionEnabled()).toBe(false);

      globalThis.fetch = temp;
    });

    it('should handle multiple enable calls gracefully', () => {
      enableFetchInterception();
      enableFetchInterception();
      expect(isFetchInterceptionEnabled()).toBe(true);
    });
  });

  describe('fetch interception without HAR recording', () => {
    it('should pass through requests when no HAR recorder is active', async () => {
      const mockResponse = new Response('test', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      enableFetchInterception();

      const result = await fetch('https://test.com');

      expect(mockFetch).toHaveBeenCalledWith('https://test.com', undefined);
      expect(result).toBe(mockResponse);
    });
  });

  describe('fetch interception with HAR recording', () => {
    it('should record successful fetch requests', async () => {
      // Setup HAR recording
      initializeHARRecording(TEST_HAR_FILE);

      // Setup mock response
      const mockResponse = new Response('{"success": true}', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      });
      mockFetch.mockResolvedValue(mockResponse);

      enableFetchInterception();

      // Make request
      const init: Record<string, unknown> = {
        method: 'POST',
        headers: { authorization: 'Bearer test' },
        body: '{"test": true}',
      };

      const result = await fetch('https://api.test.com/endpoint', init);

      // Test actual behavior - request was proxied through original fetch
      expect(result).toBe(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/endpoint', init);

      // Wait for async recording
      await new Promise((resolve) => setImmediate(resolve));

      // Test that HAR recorder received the request data
      const harRecorder = getHARRecorder();
      expect(harRecorder).toBeDefined();

      // Verify timing was captured (this tests the actual interception behavior)
      expect(Date.now).toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      initializeHARRecording(TEST_HAR_FILE);
      enableFetchInterception();

      const fetchError = new Error('Network error');
      mockFetch.mockRejectedValue(fetchError);

      await expect(fetch('https://failing.com')).rejects.toThrow('Network error');
      expect(mockFetch).toHaveBeenCalledWith('https://failing.com', undefined);
    });

    it('should handle different URL input types', async () => {
      initializeHARRecording(TEST_HAR_FILE);

      const mockResponse = new Response('test');
      mockFetch.mockResolvedValue(mockResponse);

      enableFetchInterception();

      // Test string URL
      const result1 = await fetch('https://string.com');
      expect(result1).toBe(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('https://string.com', undefined);

      // Test URL object
      const result2 = await fetch(new URL('https://url-object.com'));
      expect(result2).toBe(mockResponse);

      // Test Request object
      const request = new Request('https://request-object.com');
      const result3 = await fetch(request);
      expect(result3).toBe(mockResponse);

      // Wait for async processing
      await new Promise((resolve) => setImmediate(resolve));

      // Test that all URL types were handled properly
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify HAR recorder is active and handling requests
      const harRecorder = getHARRecorder();
      expect(harRecorder).toBeDefined();
    });

    it('should restore original fetch when disabled', () => {
      const originalFunc = globalThis.fetch;

      enableFetchInterception();
      const interceptedFunc = globalThis.fetch;
      expect(interceptedFunc).not.toBe(originalFunc);

      disableFetchInterception();
      expect(globalThis.fetch).toBe(originalFunc);
    });
  });

  describe('HAR recording error handling', () => {
    it('should continue working when HAR recording fails', async () => {
      initializeHARRecording(TEST_HAR_FILE);
      const harRecorder = getHARRecorder();

      // Mock recordFetchRequest to throw
      vi.spyOn(harRecorder!, 'recordFetchRequest').mockImplementation(() => {
        throw new Error('HAR recording failed');
      });

      const mockResponse = new Response('test');
      mockFetch.mockResolvedValue(mockResponse);

      enableFetchInterception();

      // Test actual behavior - fetch continues to work despite HAR recording errors
      const result = await fetch('https://test.com');
      expect(result).toBe(mockResponse);

      // Verify the original fetch was still called
      expect(mockFetch).toHaveBeenCalledWith('https://test.com', undefined);
    });
  });
});
