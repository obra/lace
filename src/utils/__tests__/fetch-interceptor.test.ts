// ABOUTME: Tests for fetch interceptor
// ABOUTME: Validates fetch monkey patching and HAR recording integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enableFetchInterception,
  disableFetchInterception,
  isFetchInterceptionEnabled,
} from '../fetch-interceptor.js';
import { initializeHARRecording, disableHARRecording, getHARRecorder } from '../har-recorder.js';
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
      delete (globalThis as any).fetch;

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

      expect(recordSpy).toHaveBeenCalledWith(
        'https://api.test.com/endpoint',
        expect.objectContaining(init), // Should match the init object we passed
        1234567890000, // startTime
        mockResponse,
        1234567890050 // endTime
      );
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
      expect(recordSpy).toHaveBeenNthCalledWith(
        1,
        'https://string.com',
        expect.objectContaining({}), // Empty object from undefined init
        1234567890000, // first call startTime
        mockResponse,
        1234567890050 // first call endTime
      );
      expect(recordSpy).toHaveBeenNthCalledWith(
        2,
        'https://url-object.com/',
        expect.objectContaining({}), // Empty object from undefined init
        1234567890100, // second call startTime
        mockResponse,
        1234567890150 // second call endTime
      );
      expect(recordSpy).toHaveBeenNthCalledWith(
        3,
        'https://request-object.com/',
        expect.objectContaining({}), // Empty object from undefined init
        1234567890200, // third call startTime
        mockResponse,
        1234567890250 // third call endTime
      );
    });

    it('should restore original fetch when disabled', async () => {
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
