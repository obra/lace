// ABOUTME: Abstract base class for all AI providers
// ABOUTME: Defines the common interface and provides base functionality for providers

import { EventEmitter } from 'events';
import { ContentBlock } from '../tools/types.js';
import { Tool } from '../tools/tool.js';

export interface ProviderConfig {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  streaming?: boolean; // Enable token-by-token streaming
  [key: string]: unknown; // Allow provider-specific config
}

export interface ProviderResponse {
  content: string;
  toolCalls: ProviderToolCall[];
  stopReason?: string; // Normalized: "max_tokens" | "stop" | "tool_use" | "error"
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  performance?: {
    // Unique value for local models
    tokensPerSecond?: number;
    timeToFirstToken?: number;
    totalDuration?: number;
  };
}

export abstract class AIProvider extends EventEmitter {
  protected readonly _config: ProviderConfig;
  protected _systemPrompt: string = '';

  // Retry configuration - can be modified in tests
  protected RETRY_CONFIG = {
    maxRetries: 10,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitterFactor: 0.1,
  };

  constructor(config: ProviderConfig) {
    super();
    this._config = config;
  }

  abstract createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse>;

  // Optional streaming support - providers can override this
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Default implementation: fall back to non-streaming
    return this.createResponse(messages, tools, signal);
  }

  // Check if provider supports streaming
  get supportsStreaming(): boolean {
    return false; // Default to false, override in providers that support it
  }

  // Access to configuration for streaming checks
  get config(): ProviderConfig {
    return this._config;
  }

  // System prompt management
  setSystemPrompt(systemPrompt: string): void {
    this._systemPrompt = systemPrompt;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  abstract get providerName(): string;
  abstract get defaultModel(): string;

  get modelName(): string {
    return this._config.model || this.defaultModel;
  }

  // Model capability getters - providers should override based on their models
  get contextWindow(): number {
    // Conservative default - providers should override
    return 8192;
  }

  get maxCompletionTokens(): number {
    // Use configured value or conservative default
    return this._config.maxTokens || 4096;
  }

  // Token estimation utility for streaming
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Provider-specific token counting - providers can override for accurate counts
  async countTokens(messages: ProviderMessage[], _tools: Tool[] = []): Promise<number | null> {
    // Default implementation returns null to indicate estimation should be used
    return null;
  }

  // System prompt handling with fallback logic
  protected getEffectiveSystemPrompt(messages: ProviderMessage[]): string {
    const systemMessage = messages.find((msg) => msg.role === 'system');
    return systemMessage?.content || this._systemPrompt || 'You are a helpful assistant.';
  }

  // Base stop reason normalization - providers should override for specific mappings
  protected normalizeStopReason(stopReason: string | null | undefined): string | undefined {
    if (!stopReason) return undefined;

    // Providers should override this method to handle their specific stop reasons
    // This base implementation provides a safe default
    return 'stop';
  }

  // Cleanup method to close connections and free resources
  async cleanup(): Promise<void> {
    // Default implementation - providers can override for specific cleanup
    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
  }

  // Retry functionality

  /**
   * Determines if an error is retryable based on error codes and status
   * Can be overridden by providers for specific error patterns
   */
  protected isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const err = error as Record<string, unknown>;

    // Check for abort errors - never retry these
    if (err.name === 'AbortError') {
      return false;
    }

    // Check for network errors (Node.js error codes)
    if (err.code) {
      const retryableCodes = [
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        'EHOSTUNREACH',
      ];
      if (retryableCodes.includes(err.code)) {
        return true;
      }
    }

    // Check for HTTP status codes
    const status = err.status || err.statusCode;
    if (status) {
      // Retry on server errors and rate limits
      if (status >= 500 || status === 429 || status === 408) {
        return true;
      }
      // Don't retry on client errors or auth errors
      if (status >= 400 && status < 500) {
        return false;
      }
    }

    return false;
  }

  /**
   * Calculates exponential backoff delay with jitter
   */
  protected calculateBackoffDelay(attempt: number): number {
    // Calculate base delay with exponential backoff
    const baseDelay = Math.min(
      this.RETRY_CONFIG.initialDelayMs * Math.pow(this.RETRY_CONFIG.backoffFactor, attempt - 1),
      this.RETRY_CONFIG.maxDelayMs
    );

    // Apply jitter to prevent thundering herd
    const jitter = baseDelay * this.RETRY_CONFIG.jitterFactor;
    const minDelay = baseDelay - jitter;
    const maxDelay = baseDelay + jitter;

    return Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);
  }

  /**
   * Wraps an operation with retry logic
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    options?: {
      maxAttempts?: number;
      isStreaming?: boolean;
      canRetry?: () => boolean;
      signal?: AbortSignal;
    }
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? this.RETRY_CONFIG.maxRetries;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check abort signal before each attempt
        if (options?.signal?.aborted) {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          throw error;
        }

        return await operation();
      } catch (error) {
        lastError = error;

        // Check if we should retry
        const shouldRetry =
          attempt < maxAttempts &&
          this.isRetryableError(error) &&
          (options?.canRetry ? options.canRetry() : true);

        if (!shouldRetry) {
          // If we've exhausted all attempts, emit exhausted event
          if (attempt === maxAttempts && this.isRetryableError(error)) {
            this.emit('retry_exhausted', {
              attempts: maxAttempts,
              lastError: error as Error,
            });
          }
          throw error;
        }

        // Calculate delay for next attempt
        const delay = this.calculateBackoffDelay(attempt);

        // Emit retry event
        this.emit('retry_attempt', {
          attempt,
          delay,
          error: error as Error,
        });

        // Wait before retrying
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), delay);

          // Handle abort during delay
          if (options?.signal) {
            const abortHandler = () => {
              clearTimeout(timer);
              const abortError = new Error('Aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            };

            if (options.signal.aborted) {
              abortHandler();
            } else {
              options.signal.addEventListener('abort', abortHandler, { once: true });
            }
          }
        });
      }
    }

    // This should never be reached as we either return or throw
    throw lastError;
  }
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderToolResult {
  id: string;
  content: ContentBlock[]; // Rich content instead of string
  isError: boolean; // Align with our naming
}

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ProviderToolCall[]; // For assistant messages with tool calls
  toolResults?: ProviderToolResult[]; // For user messages with tool results
}
