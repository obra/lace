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
      const harRecorder = getHARRecorder();
      const recordSpy = vi.spyOn(harRecorder!, 'recordFetchRequest');

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

      expect(result).toBe(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/endpoint', init);

      // Wait for async recording
      await new Promise((resolve) => setImmediate(resolve));

      expect(recordSpy).toHaveBeenCalledTimes(1);
      const [url, initArg, startTime, response, endTime] = recordSpy.mock.calls[0];

      expect(url).toBe('https://api.test.com/endpoint');
      expect(initArg).toEqual(init);
      expect(startTime).toBe(1234567890000);
      expect(response).toBeInstanceOf(Response); // Response is cloned, so check type instead
      expect(endTime).toBe(1234567890050);
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
      const harRecorder = getHARRecorder();
      const recordSpy = vi.spyOn(harRecorder!, 'recordFetchRequest');

      const mockResponse = new Response('test');
      mockFetch.mockResolvedValue(mockResponse);

      enableFetchInterception();

      // Test string URL
      await fetch('https://string.com');

      // Test URL object
      await fetch(new URL('https://url-object.com'));

      // Test Request object
      const request = new Request('https://request-object.com');
      await fetch(request);

      await new Promise((resolve) => setImmediate(resolve));

      expect(recordSpy).toHaveBeenCalledTimes(3);

      // Check first call
      const [url1, init1, startTime1, response1, endTime1] = recordSpy.mock.calls[0];
      expect(url1).toBe('https://string.com');
      expect(init1).toEqual({});
      expect(startTime1).toBe(1234567890000);
      expect(response1).toBeInstanceOf(Response); // Response is cloned, so check type instead
      expect(endTime1).toBe(1234567890050);

      // Check second call
      const [url2, init2, startTime2, response2, endTime2] = recordSpy.mock.calls[1];
      expect(url2).toBe('https://url-object.com/');
      expect(init2).toEqual({});
      expect(startTime2).toBe(1234567890100);
      expect(response2).toBeInstanceOf(Response); // Response is cloned, so check type instead
      expect(endTime2).toBe(1234567890150);

      // Check third call
      const [url3, init3, startTime3, response3, endTime3] = recordSpy.mock.calls[2];
      expect(url3).toBe('https://request-object.com/');
      expect(init3).toEqual({});
      expect(startTime3).toBe(1234567890200);
      expect(response3).toBeInstanceOf(Response); // Response is cloned, so check type instead
      expect(endTime3).toBe(1234567890250);
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

      // Should not throw despite HAR recording error
      const result = await fetch('https://test.com');
      expect(result).toBe(mockResponse);
    });
  });
});
