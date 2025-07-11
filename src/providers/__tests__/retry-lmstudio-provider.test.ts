// ABOUTME: Tests for retry functionality in LMStudioProvider
// ABOUTME: Verifies retry logic works correctly with LMStudio SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LMStudioProvider } from '~/providers/lmstudio-provider.js';
import { ProviderMessage } from '~/providers/base-provider.js';

// Create mock functions that we'll reference
const mockListLoaded = vi.fn();
const mockLoad = vi.fn();

// Mock the LMStudio SDK
vi.mock('@lmstudio/sdk', () => {
  const MockLMStudioClient = vi.fn().mockImplementation(() => ({
    llm: {
      listLoaded: mockListLoaded,
      load: mockLoad,
    },
  }));

  return { LMStudioClient: MockLMStudioClient };
});

describe('LMStudioProvider retry functionality', () => {
  let provider: LMStudioProvider;
  let mockDiagnose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset the mocks before each test
    mockListLoaded.mockReset();
    mockLoad.mockReset();

    provider = new LMStudioProvider({
      baseUrl: 'ws://localhost:1234',
    });

    // Mock the diagnose method to control connectivity
    mockDiagnose = vi.spyOn(provider, 'diagnose') as any;

    // Add error handlers to prevent unhandled errors in tests
    provider.on('error', () => {
      // Empty handler to prevent unhandled errors in tests
    });
    provider.on('retry_attempt', () => {
      // Empty handler to prevent unhandled errors in tests
    });
    provider.on('retry_exhausted', () => {
      // Empty handler to prevent unhandled errors in tests
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createResponse retry behavior', () => {
    it('should retry on network errors during model loading', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // First diagnose call fails with network error, second succeeds
      mockDiagnose
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce({ connected: true, models: ['test-model'] });

      // Mock successful model load
      const mockModel = {
        port: {
          createChannel: vi.fn((type: string, config: unknown, onMessage: (msg: any) => void) => {
            // Execute immediately with fake timers to avoid timeout
            onMessage({
              type: 'fragment',
              fragment: { content: 'Hello there!' },
            });
            onMessage({
              type: 'success',
              stats: {
                stopReason: 'stop',
                promptTokensCount: 10,
                predictedTokensCount: 5,
              },
            });
          }),
        },
        specifier: 'test-model',
        predictionConfigInputToKVConfig: vi.fn().mockReturnValue({}),
        internalKVConfigStack: { layers: [] },
        internalIgnoreServerSessionConfig: false,
      };

      mockListLoaded.mockResolvedValue([{ identifier: 'test-model' }]);
      mockLoad.mockResolvedValue(mockModel);

      const promise = provider.createResponse(messages, []);
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      // Wait for first attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(mockDiagnose).toHaveBeenCalledTimes(1);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      expect(mockDiagnose).toHaveBeenCalledTimes(2);
      expect(response.content).toBe('Hello there!');
    });

    it('should emit retry events', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockDiagnose
        .mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' })
        .mockResolvedValueOnce({ connected: true, models: ['test-model'] });

      const mockModel = {
        port: {
          createChannel: vi.fn((type: string, config: unknown, onMessage: (msg: any) => void) => {
            // Execute immediately with fake timers to avoid timeout
            onMessage({
              type: 'fragment',
              fragment: { content: 'Hello!' },
            });
            onMessage({
              type: 'success',
              stats: { stopReason: 'stop' },
            });
          }),
        },
        specifier: 'test-model',
        predictionConfigInputToKVConfig: vi.fn().mockReturnValue({}),
        internalKVConfigStack: { layers: [] },
        internalIgnoreServerSessionConfig: false,
      };

      mockListLoaded.mockResolvedValue([{ identifier: 'test-model' }]);
      mockLoad.mockResolvedValue(mockModel);

      const retryAttemptSpy = vi.fn();
      provider.on('retry_attempt', retryAttemptSpy);

      const promise = provider.createResponse(messages, []);

      // Wait for first attempt
      await vi.advanceTimersByTimeAsync(0);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      await promise;

      expect(retryAttemptSpy).toHaveBeenCalledWith({
        attempt: 1,
        delay: expect.any(Number),
        error: expect.objectContaining({ status: 503 }),
      });
    });

    it('should not retry on authentication errors', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const authError = { status: 401, message: 'Invalid API key' };
      mockDiagnose.mockRejectedValue(authError);

      await expect(provider.createResponse(messages, [])).rejects.toEqual(authError);
      expect(mockDiagnose).toHaveBeenCalledTimes(1);
    });

    it('should use full 10 retry attempts', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockDiagnose.mockRejectedValue({ code: 'ETIMEDOUT' });

      const exhaustedSpy = vi.fn();
      provider.on('retry_exhausted', exhaustedSpy);

      // Use real timers for this test to avoid complexity
      vi.useRealTimers();

      // Reduce delays for faster testing
      provider.RETRY_CONFIG = {
        initialDelayMs: 1,
        maxDelayMs: 2,
      };

      await expect(provider.createResponse(messages, [])).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });

      expect(mockDiagnose).toHaveBeenCalledTimes(10);
      expect(exhaustedSpy).toHaveBeenCalledWith({
        attempts: 10,
        lastError: expect.objectContaining({ code: 'ETIMEDOUT' }),
      });

      // Restore fake timers
      vi.useFakeTimers();
    });
  });

  describe('createStreamingResponse retry behavior', () => {
    it('should retry streaming requests before first token', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // First call fails, second succeeds
      mockDiagnose
        .mockRejectedValueOnce({ code: 'ECONNRESET' })
        .mockResolvedValueOnce({ connected: true, models: ['test-model'] });

      const mockModel = {
        port: {
          createChannel: vi.fn((type: string, config: unknown, onMessage: (msg: any) => void) => {
            // Execute immediately with fake timers to avoid timeout
            onMessage({
              type: 'fragment',
              fragment: { content: 'Hello world!' },
            });
            onMessage({
              type: 'success',
              stats: { stopReason: 'stop' },
            });
          }),
        },
        specifier: 'test-model',
        predictionConfigInputToKVConfig: vi.fn().mockReturnValue({}),
        internalKVConfigStack: { layers: [] },
        internalIgnoreServerSessionConfig: false,
      };

      mockListLoaded.mockResolvedValue([{ identifier: 'test-model' }]);
      mockLoad.mockResolvedValue(mockModel);

      const promise = provider.createStreamingResponse(messages, []);
      promise.catch(() => {
        // Prevent unhandled rejection in test
      }); // during retry

      // Wait for first attempt to fail
      await vi.advanceTimersByTimeAsync(0);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      expect(mockDiagnose).toHaveBeenCalledTimes(2);
      expect(response.content).toBe('Hello world!');
    });

    it('should not retry after streaming has started', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Model loaded successfully first time
      mockDiagnose.mockResolvedValue({ connected: true, models: ['test-model'] });
      mockListLoaded.mockResolvedValue([{ identifier: 'test-model' }]);

      const mockModel = {
        port: {
          createChannel: vi.fn((type: string, config: unknown, onMessage: (msg: any) => void) => {
            // Start streaming immediately (sync), then fail
            onMessage({
              type: 'fragment',
              fragment: { content: 'Hello' },
            });
            // Then simulate an error immediately
            onMessage({
              type: 'error',
              error: 'Connection lost',
            });
          }),
        },
        specifier: 'test-model',
        predictionConfigInputToKVConfig: vi.fn().mockReturnValue({}),
        internalKVConfigStack: { layers: [] },
        internalIgnoreServerSessionConfig: false,
      };

      mockLoad.mockResolvedValue(mockModel);

      // Listen for token events to detect streaming started
      let streamingStarted = false;
      provider.on('token', () => {
        streamingStarted = true;
      });

      await expect(provider.createStreamingResponse(messages, [])).rejects.toThrow(
        'LMStudio prediction failed'
      );

      // Should only try once since streaming started
      expect(mockDiagnose).toHaveBeenCalledTimes(1);
      expect(streamingStarted).toBe(true);
    });
  });
});
