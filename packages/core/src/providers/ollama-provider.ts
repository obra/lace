// ABOUTME: Ollama provider implementation using local Ollama server
// ABOUTME: Supports tool calling with models that have native tool support (like qwen3:32b)

import { Ollama, ChatResponse, Tool as OllamaTool } from 'ollama';
import { AIProvider } from '~/providers/base-provider';
import {
  ProviderMessage,
  ProviderResponse,
  ProviderConfig,
  ProviderInfo,
  ModelInfo,
} from '~/providers/base-provider';
import { ToolCall } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { logger } from '~/utils/logger';
import { logProviderRequest, logProviderResponse } from '~/utils/provider-logging';

interface OllamaProviderConfig extends ProviderConfig {
  host?: string;
  verbose?: boolean;
  [key: string]: unknown; // Allow for additional properties
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaMessage {
  content?: string;
  tool_calls?: OllamaToolCall[];
  prompt_eval_count?: number;
  eval_count?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  total_duration?: number;
}

export class OllamaProvider extends AIProvider {
  private readonly _ollama: Ollama;
  private readonly _host: string;

  constructor(config: OllamaProviderConfig = {}) {
    super(config);
    // Support custom host for Ollama instances
    // Prefer config.host over config.baseURL, but accept either
    const configHost = config.host || (config.baseURL as string | undefined);
    this._host = configHost || 'http://localhost:11434';
    logger.info('Using Ollama host', {
      host: this._host,
      source: configHost ? 'config' : 'default',
    });
    this._ollama = new Ollama({ host: this._host });
  }

  get providerName(): string {
    return 'ollama';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> {
    try {
      // Try to list models to test connection
      const models = await this._ollama.list();

      return {
        connected: true,
        models: models.models.map((m) => m.name),
      };
    } catch (error: unknown) {
      return {
        connected: false,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        // First check if we can connect and if the model exists
        const diagnostics = await this.diagnose();

        if (!diagnostics.connected) {
          throw new Error(
            `Cannot connect to Ollama server at ${this._host}.\n` +
              `Make sure Ollama is running and accessible.\n\n` +
              `To fix this:\n` +
              `  - Start Ollama service: 'ollama serve'\n` +
              `  - Ensure the server is running on ${this._host}\n` +
              `  - Check firewall settings if using a remote server\n\n` +
              `Connection error: ${diagnostics.error}`
          );
        }

        // Check if our target model is available
        if (!diagnostics.models.includes(model)) {
          throw new Error(
            `Model "${model}" is not available in Ollama.\n\n` +
              `Available models: ${diagnostics.models.join(', ')}\n\n` +
              `To fix this:\n` +
              `  - Pull the model: 'ollama pull ${model}'\n` +
              `  - Choose an available model from the list above\n` +
              `  - Use --provider anthropic as fallback`
          );
        }

        // Convert messages to Ollama format
        const ollamaMessages = [];

        // Add system prompt if configured
        if (this._systemPrompt) {
          ollamaMessages.push({
            role: 'system',
            content: this._systemPrompt,
          });
        }

        // Add conversation messages
        ollamaMessages.push(
          ...messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))
        );

        // Prepare the request payload
        const requestPayload = {
          model,
          messages: ollamaMessages,
          stream: false as const,
          tools:
            tools.length > 0
              ? tools.map(
                  (tool): OllamaTool => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    },
                  })
                )
              : undefined,
        };

        // Log request with pretty formatting
        logProviderRequest('ollama', requestPayload as unknown as Record<string, unknown>);

        // Make the request
        // Handle abort signal
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        const response: ChatResponse = await this._ollama.chat(requestPayload);

        // If the response is an AbortableAsyncIterator and signal is provided, set up abort handling
        if (
          signal &&
          'abort' in response &&
          typeof (response as unknown as { abort?: () => void }).abort === 'function'
        ) {
          signal.addEventListener('abort', () => {
            (response as unknown as { abort: () => void }).abort();
          });
        }

        // Log response with pretty formatting
        logProviderResponse('ollama', response);

        // Extract content and tool calls
        const content = response.message?.content || '';
        const toolCalls = (response.message?.tool_calls || []).map((tc, index: number) => ({
          id: `call_${index + 1}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        logger.debug('Parsed Ollama response', {
          provider: 'ollama',
          model,
          contentLength: content.length,
          toolCallCount: toolCalls.length,
          toolCallNames: toolCalls.map((tc) => tc.name),
        });

        return {
          content,
          toolCalls,
          stopReason: response.done ? 'stop' : undefined,
          usage: this._extractUsage(response),
          performance: this._extractPerformance(response),
        };
      },
      { signal }
    );
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    let streamingStarted = false;
    let streamCreated = false;

    return this.withRetry(
      async () => {
        // First check if we can connect and if the model exists
        const diagnostics = await this.diagnose();

        if (!diagnostics.connected) {
          throw new Error(
            `Cannot connect to Ollama server at ${this._host}.\n` +
              `Make sure Ollama is running and accessible.\n\n` +
              `To fix this:\n` +
              `  - Start Ollama service: 'ollama serve'\n` +
              `  - Ensure the server is running on ${this._host}\n` +
              `  - Check firewall settings if using a remote server\n\n` +
              `Connection error: ${diagnostics.error}`
          );
        }

        // Check if our target model is available
        if (!diagnostics.models.includes(model)) {
          throw new Error(
            `Model "${model}" is not available in Ollama.\n\n` +
              `Available models: ${diagnostics.models.join(', ')}\n\n` +
              `To fix this:\n` +
              `  - Pull the model: 'ollama pull ${model}'\n` +
              `  - Choose an available model from the list above\n` +
              `  - Use --provider anthropic as fallback`
          );
        }

        // Convert messages to Ollama format
        const ollamaMessages = [];

        // Add system prompt if configured
        if (this._systemPrompt) {
          ollamaMessages.push({
            role: 'system',
            content: this._systemPrompt,
          });
        }

        // Add conversation messages
        ollamaMessages.push(
          ...messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))
        );

        // Prepare the request payload for streaming
        const requestPayload = {
          model,
          messages: ollamaMessages,
          stream: true as const,
          tools:
            tools.length > 0
              ? tools.map(
                  (tool): OllamaTool => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    },
                  })
                )
              : undefined,
        };

        // Log streaming request with pretty formatting
        logProviderRequest('ollama', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        // Handle abort signal
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        // Make the streaming request
        const response = await this._ollama.chat(requestPayload);

        // Mark that stream is created to prevent retries after this point
        streamCreated = true;

        // If the response is an AbortableAsyncIterator and signal is provided, set up abort handling
        if (
          signal &&
          'abort' in response &&
          typeof (response as unknown as { abort?: () => void }).abort === 'function'
        ) {
          signal.addEventListener('abort', () => {
            (response as unknown as { abort: () => void }).abort();
          });
        }

        let content = '';
        let toolCalls: ToolCall[] = [];
        let finalMessage: OllamaMessage | null = null;
        let estimatedOutputTokens = 0;

        try {
          // Process streaming response
          for await (const part of response) {
            if (part.message?.content) {
              streamingStarted = true; // Mark that streaming has begun
              // Emit token events for real-time display
              this.emit('token', { token: part.message.content });
              content += part.message.content;

              // If no token counts available yet, estimate progressively
              if (part.prompt_eval_count === undefined && part.eval_count === undefined) {
                const newTokens = Math.ceil(part.message.content.length / 4);
                estimatedOutputTokens += newTokens;

                this.emit('token_usage_update', {
                  usage: {
                    promptTokens: 0, // Unknown during streaming
                    completionTokens: estimatedOutputTokens,
                    totalTokens: estimatedOutputTokens,
                  },
                });
              }
            }

            // Emit token usage updates if available (usually in final response)
            if (part.prompt_eval_count !== undefined || part.eval_count !== undefined) {
              const promptTokens = part.prompt_eval_count || 0;
              const completionTokens = part.eval_count || 0;

              this.emit('token_usage_update', {
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                },
              });
            }

            // Store the final message for tool calls
            if (part.done) {
              finalMessage = part.message;
            }
          }

          // Extract tool calls from final message
          if (finalMessage?.tool_calls) {
            toolCalls = finalMessage.tool_calls.map((tc: OllamaToolCall, index: number) => ({
              id: `call_${index + 1}`,
              name: tc.function.name,
              arguments: tc.function.arguments,
            }));
          }

          // Log streaming response with pretty formatting
          logProviderResponse('ollama', { content, toolCalls, finalMessage }, { streaming: true });

          const result = {
            content,
            toolCalls,
            stopReason: 'stop', // Streaming always completes normally
            usage: finalMessage ? this._extractUsageFromMessage(finalMessage) : undefined,
            performance: this._extractPerformanceFromStream(finalMessage),
          };

          // Emit completion event
          this.emit('complete', { response: result });

          return result;
        } catch (error) {
          const errorObj = error as Error;
          logger.error('Streaming error from Ollama', { error: errorObj.message });
          throw error;
        }
      },
      {
        signal,
        isStreaming: true,
        canRetry: () => !streamCreated && !streamingStarted,
      }
    );
  }

  private _extractUsage(
    response: OllamaMessage
  ): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
    if (!response.prompt_eval_count && !response.eval_count) return undefined;

    const promptTokens = response.prompt_eval_count || 0;
    const completionTokens = response.eval_count || 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  private _extractUsageFromMessage(
    message: OllamaMessage
  ): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
    // For streaming, token counts might be in different locations
    return this._extractUsage(message);
  }

  private _extractPerformance(
    response: OllamaMessage
  ): { tokensPerSecond?: number; timeToFirstToken?: number; totalDuration?: number } | undefined {
    if (!response.total_duration && !response.eval_duration) return undefined;

    const result: { tokensPerSecond?: number; timeToFirstToken?: number; totalDuration?: number } =
      {};

    if (response.total_duration) {
      result.totalDuration = response.total_duration / 1_000_000; // Convert nanoseconds to milliseconds
    }

    if (response.eval_duration && response.eval_count) {
      const durationSeconds = response.eval_duration / 1_000_000_000; // Convert nanoseconds to seconds
      result.tokensPerSecond = response.eval_count / durationSeconds;
    }

    if (response.prompt_eval_duration) {
      result.timeToFirstToken = response.prompt_eval_duration / 1_000_000; // Convert nanoseconds to milliseconds
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private _extractPerformanceFromStream(
    finalMessage: OllamaMessage | null
  ): { tokensPerSecond?: number; timeToFirstToken?: number; totalDuration?: number } | undefined {
    return finalMessage ? this._extractPerformance(finalMessage) : undefined;
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'ollama',
      displayName: 'Ollama',
      requiresApiKey: false,
      configurationHint: 'Ensure Ollama is running on localhost:11434',
    };
  }

  getAvailableModels(): ModelInfo[] {
    // Common Ollama models - actual list depends on what's pulled
    return [
      {
        id: 'llama3.1:latest',
        displayName: 'Llama 3.1',
        description: "Meta's latest Llama model",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
        isDefault: true,
      },
      {
        id: 'qwen2.5-coder:latest',
        displayName: 'Qwen 2.5 Coder',
        description: "Alibaba's coding-focused model",
        contextWindow: 32768,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
      },
      {
        id: 'deepseek-coder-v2:latest',
        displayName: 'DeepSeek Coder V2',
        description: 'Specialized coding model',
        contextWindow: 16384,
        maxOutputTokens: 4096,
        capabilities: ['function-calling'],
      },
      {
        id: 'mistral:latest',
        displayName: 'Mistral',
        description: 'Efficient open model',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        capabilities: [],
      },
      {
        id: 'codellama:latest',
        displayName: 'Code Llama',
        description: "Meta's code-specialized model",
        contextWindow: 16384,
        maxOutputTokens: 4096,
        capabilities: [],
      },
    ];
  }

  isConfigured(): boolean {
    // Ollama just needs to be running - no API key required
    return true;
  }
}
