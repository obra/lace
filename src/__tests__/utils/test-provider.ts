// ABOUTME: Mock provider for testing that returns predictable responses
// ABOUTME: Avoids expensive LLM calls during test execution

import { AIProvider } from '~/providers/base-provider';
import { ProviderMessage, ProviderResponse, ProviderConfig } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';

export interface TestProviderConfig extends ProviderConfig {
  mockResponse?: string;
  shouldError?: boolean;
  delay?: number;
}

export class TestProvider extends AIProvider {
  private readonly mockResponse: string;
  private readonly shouldError: boolean;
  private readonly delay: number;

  constructor(config: TestProviderConfig = {}) {
    super(config);
    this.mockResponse = config.mockResponse || 'Mock response from test provider';
    this.shouldError = config.shouldError || false;
    this.delay = config.delay || 10; // 10ms default delay
  }

  get providerName(): string {
    return 'test-provider';
  }

  get defaultModel(): string {
    return 'test-model';
  }

  get supportsStreaming(): boolean {
    return false;
  }

  diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> {
    if (this.shouldError) {
      return Promise.resolve({
        connected: false,
        models: [],
        error: 'Mock provider error',
      });
    }

    return Promise.resolve({
      connected: true,
      models: ['test-model'],
    });
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, this.delay));

    if (signal?.aborted) {
      throw new Error('Request was aborted');
    }

    if (this.shouldError) {
      throw new Error('Mock provider error during response creation');
    }

    return {
      content: this.mockResponse,
      toolCalls: [],
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
      stopReason: 'end_turn',
    };
  }

  async createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // For test provider, just return the same as non-streaming
    return await this.createResponse(_messages, _tools, signal);
  }
}
