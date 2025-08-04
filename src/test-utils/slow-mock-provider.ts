// ABOUTME: Slow mock provider for testing stop functionality
// ABOUTME: Simulates slow responses to allow testing stop/abort behavior

import { ProviderMessage, ProviderResponse, ProviderConfig } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';

export interface SlowMockProviderConfig extends ProviderConfig {
  mockResponse?: string;
  delay?: number;
  shouldError?: boolean;
  streaming?: boolean;
}

export class SlowMockProvider extends BaseMockProvider {
  private readonly mockResponse: string;
  private readonly delay: number;
  private readonly shouldError: boolean;
  private readonly streaming: boolean;

  constructor(config: SlowMockProviderConfig = {}) {
    super(config);
    this.mockResponse =
      config.mockResponse || 'This is a slow mock response for testing stop functionality.';
    this.delay = config.delay || 5000; // 5 second default delay
    this.shouldError = config.shouldError || false;
    this.streaming = config.streaming || false;
  }

  get providerName(): string {
    return 'slow-mock-provider';
  }

  get defaultModel(): string {
    return 'slow-mock-model';
  }

  get supportsStreaming(): boolean {
    return this.streaming;
  }

  diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> {
    if (this.shouldError) {
      return Promise.resolve({
        connected: false,
        models: [],
        error: 'Slow mock provider error',
      });
    }

    return Promise.resolve({
      connected: true,
      models: ['slow-mock-model'],
    });
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Create a promise that resolves after the delay
    const delayPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, this.delay);
    });

    // Check for abort signal periodically during delay
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal?.aborted) {
        reject(new Error('Request was aborted'));
        return;
      }

      const checkAborted = () => {
        if (signal?.aborted) {
          reject(new Error('Request was aborted'));
        } else {
          setTimeout(checkAborted, 100); // Check every 100ms
        }
      };

      setTimeout(checkAborted, 100);
    });

    try {
      // Race between delay and abort
      await Promise.race([delayPromise, abortPromise]);
    } catch (error) {
      // If aborted, throw the abort error
      throw error;
    }

    // Final abort check after delay completes
    if (signal?.aborted) {
      throw new Error('Request was aborted');
    }

    if (this.shouldError) {
      throw new Error('Slow mock provider error during response creation');
    }

    return {
      content: this.mockResponse,
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
      },
      stopReason: 'end_turn',
    };
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (!this.streaming) {
      return await this.createResponse(messages, tools, signal);
    }

    // For streaming, simulate token-by-token emission with delays
    const words = this.mockResponse.split(' ');
    let accumulatedContent = '';

    for (let i = 0; i < words.length; i++) {
      // Check for abort before each word
      if (signal?.aborted) {
        throw new Error('Request was aborted');
      }

      // Add word with space (except for last word)
      const wordToAdd = i === words.length - 1 ? words[i] : words[i] + ' ';
      accumulatedContent += wordToAdd;

      // Emit token event
      this.emit('token', { token: wordToAdd });

      // Wait between words to simulate streaming delay
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, this.delay / words.length);

        const checkAbort = () => {
          if (signal?.aborted) {
            clearTimeout(timeout);
            reject(new Error('Request was aborted'));
          }
        };

        if (signal) {
          signal.addEventListener('abort', checkAbort, { once: true });
        }
      });
    }

    // Final abort check
    if (signal?.aborted) {
      throw new Error('Request was aborted');
    }

    if (this.shouldError) {
      throw new Error('Slow mock provider error during streaming response creation');
    }

    return {
      content: accumulatedContent,
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
      },
      stopReason: 'end_turn',
    };
  }
}
