// ABOUTME: Ollama provider implementation using local Ollama server
// ABOUTME: Supports tool calling with models that have native tool support (like qwen3:32b)

import { Ollama, ChatResponse, Tool as OllamaTool } from 'ollama';
import { AIProvider, ProviderMessage, ProviderResponse, ProviderConfig } from './types.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';

export interface OllamaProviderConfig extends ProviderConfig {
  host?: string;
  verbose?: boolean;
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
    this._host = config.host || 'http://localhost:11434';
    this._ollama = new Ollama({ host: this._host });
  }

  get providerName(): string {
    return 'ollama';
  }

  get defaultModel(): string {
    return 'qwen3:32b';
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
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const modelId = this._config.model || this.defaultModel;

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
    if (!diagnostics.models.includes(modelId)) {
      throw new Error(
        `Model "${modelId}" is not available in Ollama.\n\n` +
          `Available models: ${diagnostics.models.join(', ')}\n\n` +
          `To fix this:\n` +
          `  - Pull the model: 'ollama pull ${modelId}'\n` +
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

    logger.debug('Sending request to Ollama', {
      provider: 'ollama',
      model: modelId,
      messageCount: ollamaMessages.length,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
    });

    // Prepare the request payload
    const requestPayload = {
      model: modelId,
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
                  parameters: tool.input_schema,
                },
              })
            )
          : undefined,
    };

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

    logger.debug('Received response from Ollama', {
      provider: 'ollama',
      model: modelId,
      messageContent: response.message?.content,
      hasToolCalls: !!response.message?.tool_calls,
      toolCallCount: response.message?.tool_calls?.length || 0,
    });

    // Extract content and tool calls
    const content = response.message?.content || '';
    const toolCalls = (response.message?.tool_calls || []).map((tc, index: number) => ({
      id: `call_${index + 1}`,
      name: tc.function.name,
      input: tc.function.arguments,
    }));

    logger.debug('Parsed Ollama response', {
      provider: 'ollama',
      model: modelId,
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
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const modelId = this._config.model || this.defaultModel;

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
    if (!diagnostics.models.includes(modelId)) {
      throw new Error(
        `Model "${modelId}" is not available in Ollama.\n\n` +
          `Available models: ${diagnostics.models.join(', ')}\n\n` +
          `To fix this:\n` +
          `  - Pull the model: 'ollama pull ${modelId}'\n` +
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

    logger.debug('Sending streaming request to Ollama', {
      provider: 'ollama',
      model: modelId,
      messageCount: ollamaMessages.length,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
    });

    // Prepare the request payload for streaming
    const requestPayload = {
      model: modelId,
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
                  parameters: tool.input_schema,
                },
              })
            )
          : undefined,
    };

    // Handle abort signal
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Make the streaming request
    const response = await this._ollama.chat(requestPayload);

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
    let toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let finalMessage: OllamaMessage | null = null;
    let estimatedOutputTokens = 0;

    try {
      // Process streaming response
      for await (const part of response) {
        if (part.message?.content) {
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
          input: tc.function.arguments,
        }));
      }

      logger.debug('Received streaming response from Ollama', {
        provider: 'ollama',
        model: modelId,
        contentLength: content.length,
        toolCallCount: toolCalls.length,
        toolCallNames: toolCalls.map((tc) => tc.name),
      });

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
      this.emit('error', { error: errorObj });
      throw error;
    }
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
}
