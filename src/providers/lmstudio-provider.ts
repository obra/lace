// ABOUTME: LMStudio provider implementation using local LMStudio server
// ABOUTME: Uses native tool calling via low-level channel API for proper tool execution

import { LMStudioClient } from '@lmstudio/sdk';
import { AIProvider } from './base-provider.js';
import { ProviderMessage, ProviderResponse, ProviderConfig } from './base-provider.js';
import { Tool } from '../tools/tool.js';
import { logger } from '../utils/logger.js';

// Interface for LMStudio model objects
interface LMStudioModel {
  // Access to the low-level port for native tool calling
  port: {
    createChannel(type: string, config: unknown, onMessage: (message: unknown) => void): unknown;
  };
  specifier: string;
  predictionConfigInputToKVConfig(input: unknown): unknown;
  internalKVConfigStack: { layers: unknown[] };
  internalIgnoreServerSessionConfig: boolean;
}

export interface LMStudioProviderConfig extends ProviderConfig {
  baseUrl?: string;
  verbose?: boolean;
  [key: string]: unknown; // Allow for additional properties
}

export class LMStudioProvider extends AIProvider {
  private readonly _client: LMStudioClient;
  private readonly _verbose: boolean;
  private readonly _baseUrl: string;
  public _cachedModel: LMStudioModel | null = null;
  private _cachedModelId: string | null = null;

  constructor(config: LMStudioProviderConfig = {}) {
    super(config);
    this._baseUrl = config.baseUrl || 'ws://localhost:1234';
    this._client = new LMStudioClient({
      baseUrl: this._baseUrl,
    });
    this._verbose = config.verbose ?? false;
  }

  get providerName(): string {
    return 'lmstudio';
  }

  get defaultModel(): string {
    return 'qwen/qwen3-30b-a3b';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> {
    try {
      logger.info('Connecting to LMStudio', { baseUrl: this._baseUrl });

      // Try to list loaded models to test connection
      const models = await this._client.llm.listLoaded();
      logger.info('Connected to LMStudio successfully');
      logger.info('Loaded models from LMStudio', {
        count: models.length,
        models: models.map((m) => m.identifier),
      });

      return {
        connected: true,
        models: models.map((m) => m.identifier),
      };
    } catch (error: unknown) {
      logger.warn('LMStudio connection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
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
    return this.withRetry(
      async () => {
        await this._ensureModelLoaded(this.modelName);

        logger.debug('Creating LMStudio response with native tool calling', {
          provider: 'lmstudio',
          model: this.modelName,
          messageCount: messages.length,
          toolCount: tools.length,
          toolNames: tools.map((t) => t.name),
        });

        return this._createResponseWithNativeToolCalling(messages, tools, this.modelName, signal);
      },
      { signal }
    );
  }

  private async _ensureModelLoaded(modelId: string): Promise<void> {
    // Check if we have a cached model for this modelId
    if (this._cachedModel && this._cachedModelId === modelId) {
      logger.debug('Using cached LMStudio model', { modelId });
      return;
    }

    // Need to get/load the model
    const diagnostics = await this.diagnose();

    if (!diagnostics.connected) {
      throw new Error(
        `Cannot connect to LMStudio server at ${this._baseUrl}.\n` +
          `Make sure LMStudio is running and accessible.\n\n` +
          `To fix this:\n` +
          `  - Start LMStudio application\n` +
          `  - Ensure the server is running on ${this._baseUrl}\n` +
          `  - Check firewall settings if using a remote server\n\n` +
          `Connection error: ${diagnostics.error}`
      );
    }

    // Check if any models are loaded
    if (diagnostics.models.length === 0) {
      throw new Error(
        `No models are currently loaded in LMStudio.\n\n` +
          `To fix this:\n` +
          `  - Open LMStudio and load a model\n` +
          `  - Download ${modelId} if not available\n` +
          `  - Or use --provider anthropic as fallback`
      );
    }

    // Check if our target model is already loaded
    if (diagnostics.models.includes(modelId)) {
      logger.info('Found already loaded model', { modelId });
      // Get reference to existing loaded model from the list
      const loadedModels = await this._client.llm.listLoaded();
      const existingModel = loadedModels.find((m) => m.identifier === modelId);

      if (existingModel) {
        logger.info('Using existing model instance', { modelId });
        this._cachedModel = existingModel as unknown as LMStudioModel;
        this._cachedModelId = modelId;
      } else {
        throw new Error(`Model "${modelId}" appears loaded but could not retrieve instance`);
      }
    } else {
      logger.info('Target model not loaded, available models', {
        targetModel: modelId,
        availableModels: diagnostics.models,
      });
      logger.info('Attempting to load model', { modelId });

      try {
        this._cachedModel = (await this._client.llm.load(modelId, {
          verbose: this._verbose,
        })) as unknown as LMStudioModel;
        this._cachedModelId = modelId;
        logger.info('Model loaded successfully', { modelId });
      } catch (error: unknown) {
        // Provide helpful error messages based on the error type
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage?.includes('insufficient system resources')) {
          const loadedCount = diagnostics.models.length;
          const hasMultipleCopies =
            diagnostics.models.filter((m) => m.startsWith(modelId)).length > 1;

          let specific = '';
          if (loadedCount > 3) {
            specific += `\n🚨 You have ${loadedCount} models loaded, which is quite a lot!`;
          }
          if (hasMultipleCopies) {
            specific += `\n🚨 Multiple copies of the same model detected. Consider unloading duplicates.`;
          }

          throw new Error(
            `LMStudio model loading failed due to insufficient system resources.${specific}\n\n` +
              `Currently loaded models (${loadedCount}): ${diagnostics.models.join(', ')}\n\n` +
              `To fix this:\n` +
              `  1. Open LMStudio and unload unused models (especially duplicates)\n` +
              `  2. Keep only one instance of ${modelId} loaded\n` +
              `  3. Try again, or use --provider anthropic as fallback\n\n` +
              `Original error: ${errorMessage}`
          );
        } else if (
          errorMessage?.includes('ECONNREFUSED') ||
          errorMessage?.includes('Connection refused')
        ) {
          throw new Error(
            `Cannot connect to LMStudio server.\n` +
              `Make sure LMStudio is running and accessible at the configured URL.\n\n` +
              `To fix this:\n` +
              `  - Start LMStudio application\n` +
              `  - Ensure the server is running on ws://localhost:1234\n` +
              `  - Check firewall settings if using a remote server\n\n` +
              `Original error: ${errorMessage}`
          );
        } else if (
          errorMessage?.includes('Model not found') ||
          errorMessage?.includes('not available')
        ) {
          throw new Error(
            `Model "${modelId}" is not available in LMStudio.\n\n` +
              `To fix this:\n` +
              `  - Download the model in LMStudio\n` +
              `  - Check the model name is correct\n` +
              `  - Use --provider anthropic if LMStudio isn't set up\n\n` +
              `Original error: ${errorMessage}`
          );
        } else {
          throw new Error(
            `LMStudio connection failed: ${errorMessage}\n\n` +
              `Common solutions:\n` +
              `  - Ensure LMStudio is running\n` +
              `  - Check if the model is loaded\n` +
              `  - Try restarting LMStudio\n` +
              `  - Use --provider anthropic as fallback`
          );
        }
      }
    }
  }

  private async _createResponseWithNativeToolCalling(
    messages: ProviderMessage[],
    tools: Tool[],
    modelId: string,
    signal?: AbortSignal,
    streamingStartedCallback?: () => void
  ): Promise<ProviderResponse> {
    // Convert tools to LMStudio format
    let rawTools;
    if (tools.length === 0) {
      rawTools = { type: 'none' };
    } else {
      rawTools = {
        type: 'toolArray',
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      };
    }

    // Note: Tools are not executed here - the Agent handles execution

    // Convert messages to LMStudio format with proper tool result handling
    interface OpenAIStyleMessage {
      role: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
      tool_call_id?: string;
    }

    const lmMessages: OpenAIStyleMessage[] = [];

    // Add system prompt if configured
    if (this._systemPrompt) {
      lmMessages.push({
        role: 'system',
        content: this._systemPrompt,
      });
    }

    for (const msg of messages) {
      // For assistant messages with tool calls, add the assistant message with tool_calls array
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        lmMessages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.input),
            },
          })),
        });
      } else if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
        // For user messages with tool results, convert to tool messages
        // First add the user message if it has content
        if (msg.content) {
          lmMessages.push({
            role: 'user',
            content: msg.content,
          });
        }

        // Then add tool result messages
        for (const result of msg.toolResults) {
          lmMessages.push({
            role: 'tool',
            content: result.content.map((block) => block.text || '').join('\n'),
            tool_call_id: result.id,
          });
        }
      } else {
        // Regular messages
        lmMessages.push({
          role: msg.role,
          content: msg.content || '',
        });
      }
    }

    // Create chat data structure manually to support tool messages
    // Chat.from() doesn't accept OpenAI-style tool_calls or role:'tool' messages
    const chatData = {
      messages: lmMessages.map((msg) => {
        // Handle tool result messages
        if (msg.role === 'tool') {
          return {
            role: msg.role,
            content: [
              {
                type: 'toolCallResult',
                toolCallId: msg.tool_call_id,
                content: msg.content || '',
              },
            ],
          };
        }

        // Handle assistant messages with tool calls
        if (msg.role === 'assistant' && msg.tool_calls) {
          const content = [];

          // Add text content if present
          if (msg.content) {
            content.push({
              type: 'text',
              text: msg.content,
            });
          }

          // Add tool call request blocks
          msg.tool_calls.forEach((toolCall) => {
            content.push({
              type: 'toolCallRequest',
              toolCallRequest: {
                id: toolCall.id,
                type: toolCall.type,
                name: toolCall.function.name,
                arguments: JSON.parse(toolCall.function.arguments),
              },
            });
          });

          return {
            role: msg.role,
            content,
          };
        }

        // Regular text messages
        return {
          role: msg.role,
          content: [
            {
              type: 'text',
              text: msg.content || '',
            },
          ],
        };
      }),
    };

    // Create config stack
    const toolConfig = this._cachedModel!.predictionConfigInputToKVConfig({
      maxTokens: this._config.maxTokens,
      temperature: this._config.temperature,
      rawTools,
    });

    const predictionConfigStack = {
      layers: [
        ...this._cachedModel!.internalKVConfigStack.layers,
        {
          layerName: 'apiOverride',
          config: toolConfig,
        },
      ],
    };

    logger.debug('LMStudio native tool calling request', {
      provider: 'lmstudio',
      model: modelId,
      messageCount: lmMessages.length,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
    });

    return new Promise((resolve, reject) => {
      let allContent = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let chunkCount = 0;
      let resolved = false;
      let estimatedOutputTokens = 0;

      try {
        // Handle abort signal
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        // Create the low-level prediction channel
        this._cachedModel!.port.createChannel(
          'predict',
          {
            modelSpecifier: this._cachedModel!.specifier,
            history: chatData,
            predictionConfigStack,
            fuzzyPresetIdentifier: undefined,
            ignoreServerSessionConfig: this._cachedModel!.internalIgnoreServerSessionConfig,
          },
          async (message: unknown) => {
            const msg = message as {
              type: string;
              fragment?: { content?: string };
              toolCallRequest?: { id: string; name: string; arguments: Record<string, unknown> };
              stats?: {
                stopReason?: string;
                promptTokensCount?: number;
                promptTokens?: number;
                predictedTokensCount?: number;
                completionTokens?: number;
                totalTokensCount?: number;
                tokensPerSecond?: number;
                totalDuration?: number;
                timeToFirstTokenSec?: number;
              };
              error?: string;
            };
            logger.debug('LMStudio channel message', { type: msg.type });

            switch (msg.type) {
              case 'fragment': {
                chunkCount++;
                const fragment = msg.fragment;

                if (fragment?.content) {
                  allContent += fragment.content;
                  // Mark that streaming has started
                  if (streamingStartedCallback) {
                    streamingStartedCallback();
                  }
                  // Emit token events for streaming
                  this.emit('token', { token: fragment.content });

                  // If no stats available, estimate tokens progressively
                  if (!msg.stats) {
                    const newTokens = Math.ceil(fragment.content.length / 4);
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

                // Emit token usage updates if stats are available in fragment
                if (msg.stats) {
                  const promptTokens = msg.stats.promptTokensCount || msg.stats.promptTokens || 0;
                  const completionTokens =
                    msg.stats.predictedTokensCount || msg.stats.completionTokens || 0;

                  this.emit('token_usage_update', {
                    usage: {
                      promptTokens,
                      completionTokens,
                      totalTokens: promptTokens + completionTokens,
                    },
                  });
                }
                break;
              }

              case 'toolCallGenerationStart': {
                logger.debug('LMStudio tool call generation started');
                break;
              }

              case 'toolCallGenerationEnd': {
                logger.debug('LMStudio tool call generation ended', {
                  toolCall: msg.toolCallRequest,
                });

                const toolCallRequest = msg.toolCallRequest;
                if (!toolCallRequest) return;
                const toolName = toolCallRequest.name;
                const toolArgs = toolCallRequest.arguments;

                // Record the tool call for Agent to execute (standard flow)
                toolCalls.push({
                  id: toolCallRequest.id || `call_${toolCalls.length + 1}`,
                  name: toolName,
                  input: toolArgs,
                });

                logger.debug('LMStudio tool call detected - returning immediately', {
                  toolName,
                  arguments: toolArgs,
                });

                // Return immediately with tool calls (like other providers)
                if (!resolved) {
                  resolved = true;
                  resolve({
                    content: allContent.trim(),
                    toolCalls,
                    stopReason: 'tool_use',
                    usage: this._estimateUsage(allContent, lmMessages),
                    performance: this._calculatePerformance(chunkCount, allContent.length),
                  });
                }
                return;
              }

              case 'finished':
              case 'success': {
                logger.debug('LMStudio prediction finished', {
                  contentLength: allContent.length,
                  toolCallCount: toolCalls.length,
                  chunkCount,
                });

                // Only resolve here if we haven't already resolved due to tool calls
                if (!resolved) {
                  resolved = true;
                  resolve({
                    content: allContent.trim(),
                    toolCalls,
                    stopReason: msg.stats?.stopReason || 'stop',
                    usage: msg.stats
                      ? {
                          promptTokens: msg.stats.promptTokensCount || msg.stats.promptTokens || 0,
                          completionTokens:
                            msg.stats.predictedTokensCount || msg.stats.completionTokens || 0,
                          totalTokens:
                            msg.stats.totalTokensCount ||
                            (msg.stats.promptTokensCount || msg.stats.promptTokens || 0) +
                              (msg.stats.predictedTokensCount || msg.stats.completionTokens || 0),
                        }
                      : this._estimateUsage(allContent, lmMessages),
                    performance: msg.stats
                      ? {
                          tokensPerSecond: msg.stats.tokensPerSecond,
                          totalDuration: msg.stats.totalDuration,
                          timeToFirstToken: msg.stats.timeToFirstTokenSec,
                        }
                      : this._calculatePerformance(chunkCount, allContent.length),
                  });
                }
                break;
              }

              case 'error': {
                logger.error('LMStudio prediction error', { error: msg.error });
                if (!resolved) {
                  resolved = true;
                  reject(new Error(`LMStudio prediction failed: ${msg.error}`));
                }
                break;
              }

              default:
                logger.debug('LMStudio unhandled message type', { type: msg.type });
            }
          }
        );
      } catch (error) {
        logger.error('LMStudio channel creation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      }
    });
  }

  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    let streamingStarted = false;
    let modelLoaded = false;

    return this.withRetry(
      async () => {
        const modelId = this.modelName;
        await this._ensureModelLoaded(modelId);
        modelLoaded = true; // Mark model as loaded to prevent retries after this point

        logger.debug('Creating streaming LMStudio response with native tool calling', {
          provider: 'lmstudio',
          model: modelId,
          messageCount: messages.length,
          toolCount: tools.length,
          toolNames: tools.map((t) => t.name),
        });

        // Use the same native tool calling method with streaming callback
        return this._createResponseWithNativeToolCalling(messages, tools, modelId, signal, () => {
          streamingStarted = true;
        });
      },
      {
        signal,
        isStreaming: true,
        canRetry: () => !modelLoaded && !streamingStarted,
      }
    );
  }

  private _estimateUsage(
    response: string,
    messages: unknown[]
  ): { promptTokens: number; completionTokens: number; totalTokens: number } {
    // Rough estimation since .respond() doesn't provide exact token counts
    // This could be enhanced by using LMStudio's tokenizer API if available
    const promptText = messages.map((m) => (m as { content?: string }).content || '').join(' ');
    const promptTokens = Math.ceil(promptText.length / 4); // Rough estimate: ~4 chars per token
    const completionTokens = Math.ceil(response.length / 4);

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  private _calculatePerformance(
    chunkCount: number,
    responseLength: number
  ): { tokensPerSecond?: number; totalDuration?: number } | undefined {
    // Basic performance metrics from streaming data
    // This could be enhanced with actual timing data
    if (chunkCount === 0) return undefined;

    return {
      // Very rough estimate - actual implementation would need timing data
      tokensPerSecond: responseLength / 4, // Rough tokens estimate
    };
  }

  async cleanup(): Promise<void> {
    // Clean up cached model reference to help with garbage collection
    this._cachedModel = null;
    this._cachedModelId = null;

    // Call parent cleanup to remove event listeners
    await super.cleanup();

    // Note: LMStudio SDK doesn't expose explicit connection close methods
    // The WebSocket connections should be cleaned up when the client object is GC'd
    // In practice, we force exit the process to ensure cleanup
  }
}
