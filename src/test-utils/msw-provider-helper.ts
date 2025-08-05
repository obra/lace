// ABOUTME: Reusable MSW provider testing utilities for clean provider mocking
// ABOUTME: Template pattern that other engineers should use for mocking AI providers in tests

import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { beforeAll, afterAll, afterEach } from 'vitest';

export type SupportedProvider = 'anthropic' | 'openai' | 'ollama' | 'lmstudio';

export interface ProviderMockConfig {
  provider: SupportedProvider;
  baseUrl: string;
  apiKey?: string;
  defaultResponses?: string[];
}

export interface MockResponse {
  text: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

/**
 * Creates MSW server for mocking AI provider HTTP APIs
 * 
 * RECOMMENDED USAGE PATTERN:
 * 
 * ```typescript
 * describe('MyTest', () => {
 *   const providerMock = new MswProviderHelper({
 *     provider: 'anthropic',
 *     baseUrl: 'https://api.anthropic.com',
 *     apiKey: 'test-key',
 *     defaultResponses: ['Test response']
 *   });
 * 
 *   // Use built-in lifecycle management
 *   providerMock.setupTestLifecycle();
 * 
 *   it('should work with provider', async () => {
 *     providerMock.setResponses(['Custom response']);
 *     // ... run your test
 *   });
 * });
 * ```
 */
export class MswProviderHelper {
  private server: ReturnType<typeof setupServer>;
  private responses: MockResponse[] = [];
  private responseIndex = 0;
  private config: ProviderMockConfig;

  constructor(config: ProviderMockConfig) {
    this.config = config;
    this.responses = (config.defaultResponses || []).map(text => ({ text }));
    this.server = this.createServer();
  }

  private createServer() {
    switch (this.config.provider) {
      case 'anthropic':
        return this.createAnthropicServer();
      case 'openai':
        return this.createOpenAIServer();
      case 'ollama':
        return this.createOllamaServer();
      case 'lmstudio':
        return this.createLMStudioServer();
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  private createAnthropicServer() {
    return setupServer(
      http.post(`${this.config.baseUrl}/v1/messages`, async ({ request }) => {
        // Validate API key if provided
        if (this.config.apiKey) {
          const authHeader = request.headers.get('x-api-key');
          if (authHeader !== this.config.apiKey) {
            return HttpResponse.json(
              { type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } },
              { status: 401 }
            );
          }
        }

        const response = this.getNextResponse();
        const content: any[] = [{ type: 'text', text: response.text }];

        // Add tool calls if specified
        if (response.toolCalls?.length) {
          content.push(...response.toolCalls.map(tool => ({
            type: 'tool_use',
            id: tool.id,
            name: tool.name,
            input: tool.input,
          })));
        }

        return HttpResponse.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content,
          model: 'claude-3-5-haiku-20241022',
          stop_reason: response.toolCalls?.length ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
        });
      })
    );
  }

  private createOpenAIServer() {
    return setupServer(
      http.post(`${this.config.baseUrl}/v1/chat/completions`, async ({ request }) => {
        // Validate API key if provided
        if (this.config.apiKey) {
          const authHeader = request.headers.get('authorization');
          if (authHeader !== `Bearer ${this.config.apiKey}`) {
            return HttpResponse.json(
              { error: { message: 'Invalid API key', type: 'invalid_request_error' } },
              { status: 401 }
            );
          }
        }

        const response = this.getNextResponse();
        const message: any = {
          role: 'assistant',
          content: response.text,
        };

        // Add tool calls if specified
        if (response.toolCalls?.length) {
          message.tool_calls = response.toolCalls.map(tool => ({
            id: tool.id,
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.input),
            },
          }));
        }

        return HttpResponse.json({
          id: 'chatcmpl_test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [{
            index: 0,
            message,
            finish_reason: response.toolCalls?.length ? 'tool_calls' : 'stop',
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });
      })
    );
  }

  private createOllamaServer() {
    return setupServer(
      http.post(`${this.config.baseUrl}/api/chat`, async () => {
        const response = this.getNextResponse();
        return HttpResponse.json({
          model: 'llama2',
          created_at: new Date().toISOString(),
          message: {
            role: 'assistant',
            content: response.text,
          },
          done: true,
          total_duration: 1000000,
          load_duration: 500000,
          prompt_eval_count: 10,
          eval_count: 20,
        });
      }),
      http.get(`${this.config.baseUrl}/api/tags`, () => {
        return HttpResponse.json({
          models: [
            {
              name: 'llama2',
              model: 'llama2',
              modified_at: new Date().toISOString(),
              size: 3826793677,
              digest: 'test-digest',
            },
          ],
        });
      })
    );
  }

  private createLMStudioServer() {
    // LMStudio uses OpenAI-compatible API
    const baseUrl = this.config.baseUrl.replace('ws://', 'http://');
    return setupServer(
      http.post(`${baseUrl}/v1/chat/completions`, async () => {
        const response = this.getNextResponse();
        return HttpResponse.json({
          id: 'chatcmpl_lmstudio',
          object: 'chat.completion',
          created: Date.now(),
          model: 'local-model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: response.text,
            },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });
      }),
      http.get(`${baseUrl}/v1/models`, () => {
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              id: 'local-model',
              object: 'model',
              created: Date.now(),
              owned_by: 'lmstudio',
            },
          ],
        });
      })
    );
  }

  private getNextResponse(): MockResponse {
    if (this.responses.length === 0) {
      return { text: 'Mock response' };
    }

    const response = this.responses[this.responseIndex];
    this.responseIndex = (this.responseIndex + 1) % this.responses.length;
    return response;
  }

  /**
   * Set simple text responses that will be cycled through
   */
  setResponses(responses: string[]): void {
    this.responses = responses.map(text => ({ text }));
    this.responseIndex = 0;
  }

  /**
   * Set complex responses with tool calls
   */
  setComplexResponses(responses: MockResponse[]): void {
    this.responses = responses;
    this.responseIndex = 0;
  }

  /**
   * Add single response to the rotation
   */
  addResponse(response: string | MockResponse): void {
    if (typeof response === 'string') {
      this.responses.push({ text: response });
    } else {
      this.responses.push(response);
    }
  }

  /**
   * Set up MSW server lifecycle for tests
   * Call this once in your test suite
   */
  setupTestLifecycle(): void {
    beforeAll(() => this.server.listen({ onUnhandledRequest: 'error' }));
    afterAll(() => this.server.close());
    afterEach(() => this.server.resetHandlers());
  }

  /**
   * Manual server control (use if you need custom lifecycle)
   */
  start(): void {
    this.server.listen({ onUnhandledRequest: 'error' });
  }

  stop(): void {
    this.server.close();
  }

  reset(): void {
    this.server.resetHandlers();
    this.responseIndex = 0;
  }

  /**
   * Simulate network errors for error handling tests
   */
  simulateNetworkError(statusCode: number = 500, message: string = 'Server Error'): void {
    this.server.use(
      http.post('*', () => {
        return HttpResponse.json({ error: { message } }, { status: statusCode });
      })
    );
  }

  /**
   * Simulate authentication errors
   */
  simulateAuthError(): void {
    this.server.use(
      http.post('*', () => {
        if (this.config.provider === 'anthropic') {
          return HttpResponse.json(
            { type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } },
            { status: 401 }
          );
        } else {
          return HttpResponse.json(
            { error: { message: 'Invalid API key', type: 'invalid_request_error' } },
            { status: 401 }
          );
        }
      })
    );
  }

  /**
   * Create response with tool call for task completion scenarios
   */
  static createTaskCompletionResponse(taskId: string, message: string): MockResponse {
    return {
      text: `I'll complete this task: ${message}`,
      toolCalls: [{
        id: 'task_complete_call',
        name: 'task_complete',
        input: { id: taskId, message },
      }],
    };
  }

  /**
   * Create response with tool call for task blocking scenarios
   */
  static createTaskBlockedResponse(taskId: string): MockResponse {
    return {
      text: 'I encountered an issue and cannot complete this task.',
      toolCalls: [{
        id: 'task_update_call',
        name: 'task_update',
        input: { taskId, status: 'blocked' },
      }],
    };
  }
}