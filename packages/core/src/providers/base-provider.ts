// ABOUTME: Abstract base class for all AI providers
// ABOUTME: Defines the common interface and provides base functionality for providers

import { EventEmitter } from 'events';
import { ToolResult, ToolCall } from '~/tools/types';
import { Tool } from '~/tools/tool';

export interface ProviderConfig {
  maxTokens?: number;
  systemPrompt?: string;
  streaming?: boolean; // Enable token-by-token streaming
  [key: string]: unknown; // Allow provider-specific config
}

export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];
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

export interface ModelInfo {
  id: string; // Model identifier
  displayName: string; // Human-friendly name
  description?: string; // Model description
  contextWindow: number; // Max context size
  maxOutputTokens: number; // Max completion tokens
  capabilities?: string[]; // e.g., ['vision', 'function-calling']
  isDefault?: boolean; // Default model for this provider
}

export interface ProviderInfo {
  name: string; // Provider identifier
  displayName: string; // Human-friendly name
  requiresApiKey: boolean; // Needs API key vs local
  configurationHint?: string; // How to configure
}

export abstract class AIProvider extends EventEmitter {
  protected readonly _config: ProviderConfig;
  protected _systemPrompt: string = '';

  // Retry configuration - can be modified in tests but must be validated
  private _retryConfig = {
    maxRetries: 10,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitterFactor: 0.1,
  };

  public get RETRY_CONFIG(): {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
    jitterFactor: number;
  } {
    return this._retryConfig;
  }

  public set RETRY_CONFIG(config: Partial<typeof this._retryConfig>) {
    this.validateRetryConfig(config);
    this._retryConfig = { ...this._retryConfig, ...config };
  }

  private validateRetryConfig(config: Partial<typeof this._retryConfig>): void {
    if (config.maxRetries !== undefined) {
      if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
        throw new Error('maxRetries must be a non-negative integer');
      }
      if (config.maxRetries > 50) {
        throw new Error('maxRetries cannot exceed 50 to prevent excessive retry loops');
      }
    }

    if (config.initialDelayMs !== undefined) {
      if (!Number.isInteger(config.initialDelayMs) || config.initialDelayMs < 0) {
        throw new Error('initialDelayMs must be a non-negative integer');
      }
      if (config.initialDelayMs > 60000) {
        throw new Error('initialDelayMs cannot exceed 60000ms (1 minute)');
      }
    }

    if (config.maxDelayMs !== undefined) {
      if (!Number.isInteger(config.maxDelayMs) || config.maxDelayMs < 0) {
        throw new Error('maxDelayMs must be a non-negative integer');
      }
      if (config.maxDelayMs > 300000) {
        throw new Error('maxDelayMs cannot exceed 300000ms (5 minutes)');
      }
    }

    if (config.backoffFactor !== undefined) {
      if (typeof config.backoffFactor !== 'number' || config.backoffFactor < 1) {
        throw new Error('backoffFactor must be a number >= 1');
      }
      if (config.backoffFactor > 10) {
        throw new Error('backoffFactor cannot exceed 10 to prevent excessive delays');
      }
    }

    if (config.jitterFactor !== undefined) {
      if (
        typeof config.jitterFactor !== 'number' ||
        config.jitterFactor < 0 ||
        config.jitterFactor >= 1
      ) {
        throw new Error('jitterFactor must be a number between 0 (inclusive) and 1 (exclusive)');
      }
    }

    // Cross-validation
    const newInitialDelay = config.initialDelayMs ?? this._retryConfig.initialDelayMs;
    const newMaxDelay = config.maxDelayMs ?? this._retryConfig.maxDelayMs;

    if (newInitialDelay > newMaxDelay) {
      throw new Error('initialDelayMs cannot be greater than maxDelayMs');
    }
  }

  constructor(config: ProviderConfig) {
    super();
    this._config = config;
  }

  abstract createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse>;

  // Optional streaming support - providers can override this
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Default implementation: fall back to non-streaming
    return this.createResponse(messages, tools, model, signal);
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

  // Provider metadata - must be implemented by each provider
  abstract getProviderInfo(): ProviderInfo;
  abstract getAvailableModels(): ModelInfo[];

  // Check if provider is properly configured
  abstract isConfigured(): boolean;

  // Token estimation utility for streaming
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Provider-specific token counting - providers can override for accurate counts
  countTokens(
    messages: ProviderMessage[],
    _tools: Tool[] = [],
    _model?: string
  ): Promise<number | null> | number | null {
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
  cleanup(): void {
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
      if (typeof err.code === 'string' && retryableCodes.includes(err.code)) {
        return true;
      }
    }

    // Check for HTTP status codes
    const status = err.status || err.statusCode;
    if (typeof status === 'number') {
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
    const config = this.RETRY_CONFIG;
    // Calculate base delay with exponential backoff
    const baseDelay = Math.min(
      config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1),
      config.maxDelayMs
    );

    // Apply jitter to prevent thundering herd
    const jitter = baseDelay * config.jitterFactor;
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
    const config = this.RETRY_CONFIG;
    const maxAttempts = options?.maxAttempts ?? config.maxRetries;
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
          let timer: ReturnType<typeof setTimeout> | null = null;
          let abortListener: (() => void) | null = null;

          const cleanup = () => {
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            if (abortListener && options?.signal) {
              options.signal.removeEventListener('abort', abortListener);
              abortListener = null;
            }
          };

          // Handle abort during delay
          if (options?.signal) {
            abortListener = () => {
              cleanup();
              const abortError = new Error('Aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            };

            if (options.signal.aborted) {
              abortListener();
              return;
            } else {
              options.signal.addEventListener('abort', abortListener, { once: true });
            }
          }

          // Set timer with cleanup
          timer = setTimeout(() => {
            cleanup();
            resolve();
          }, delay);
        });
      }
    }

    // This should never be reached as we either return or throw
    throw lastError;
  }
}

// Use ToolResult directly from types.ts instead of maintaining a separate type

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[]; // For assistant messages with tool calls
  toolResults?: ToolResult[]; // For user messages with tool results - using our internal type
}
