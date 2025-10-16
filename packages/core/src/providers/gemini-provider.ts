// ABOUTME: Google Gemini provider implementation
// ABOUTME: Wraps Google GenAI SDK in the common provider interface

import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { AIProvider } from './base-provider';
import { ProviderMessage, ProviderResponse, ProviderConfig, ProviderInfo } from './base-provider';
import { ToolCall } from '@lace/core/tools/types';
import { Tool } from '@lace/core/tools/tool';
import { logger } from '@lace/core/utils/logger';
import { logProviderRequest, logProviderResponse } from '@lace/core/utils/provider-logging';
import { convertToGeminiFormat } from './format-converters';

interface GeminiProviderConfig extends ProviderConfig {
  apiKey: string | null;
  [key: string]: unknown; // Allow for additional properties
}

export class GeminiProvider extends AIProvider {
  private _gemini: GoogleGenAI | null = null;

  constructor(config: GeminiProviderConfig) {
    super(config);
    // Only validate API key when actually trying to use the provider
    // Allow null for metadata-only instances used by registry
  }

  private getGeminiClient(): GoogleGenAI {
    if (!this._gemini) {
      const config = this._config as GeminiProviderConfig;
      if (!config.apiKey) {
        throw new Error(
          'Gemini API key not configured. Please set your API key in provider settings or obtain one from https://aistudio.google.com/app/apikey'
        );
      }

      this._gemini = new GoogleGenAI({
        apiKey: config.apiKey,
        vertexai: false, // Gemini API only
      });
    }
    return this._gemini;
  }

  get providerName(): string {
    return 'gemini';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  private _createRequestPayload(messages: ProviderMessage[], tools: Tool[], model: string) {
    // Convert our enhanced generic messages to Gemini format
    const contents = convertToGeminiFormat(messages);

    // Extract system message if present
    const systemInstruction = this.getEffectiveSystemPrompt(messages);

    // Convert tools to Gemini format
    const geminiTools = tools.map((tool) => ({
      functionDeclarations: [
        {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      ],
    }));

    const requestPayload = {
      model,
      contents,
      systemInstruction,
      tools: geminiTools.length > 0 ? geminiTools : undefined,
      config: {
        maxOutputTokens: this._config.maxTokens || this.getModelMaxOutputTokens(model, 8192),
      },
    };

    return requestPayload;
  }

  private _parseResponse(response: GenerateContentResponse): ProviderResponse {
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidate in Gemini response');
    }

    const parts = candidate.content?.parts || [];

    // Extract text content
    const textParts = parts.filter((part) => 'text' in part && part.text);
    const content = textParts.map((part) => ('text' in part ? part.text : '')).join('');

    // Extract tool calls
    const toolCalls: ToolCall[] = parts
      .filter((part) => 'functionCall' in part && part.functionCall)
      .map((part) => {
        if ('functionCall' in part && part.functionCall) {
          const toolName = part.functionCall.name || '';
          return {
            // Encode tool name in the ID for later format conversion
            id: `gemini_${toolName}_${Date.now()}_${Math.random().toString(36).substring(2)}`,
            name: toolName,
            arguments: part.functionCall.args || {},
          };
        }
        throw new Error('Invalid function call part');
      });

    // Extract usage
    const usage = response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    logger.debug('Received response from Gemini', {
      provider: 'gemini',
      contentLength: content.length,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map((tc) => tc.name),
      usage,
    });

    return {
      content,
      toolCalls,
      stopReason: this.normalizeStopReason(candidate.finishReason),
      usage,
    };
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[] = [],
    model: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.withRetry(
      async () => {
        const requestPayload = this._createRequestPayload(messages, tools, model);

        // Log request with pretty formatting
        logProviderRequest('gemini', requestPayload as unknown as Record<string, unknown>);

        const response = await this.getGeminiClient().models.generateContent(requestPayload);

        // Log response with pretty formatting
        logProviderResponse('gemini', response);

        return this._parseResponse(response);
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
        const requestPayload = this._createRequestPayload(messages, tools, model);

        // Log streaming request with pretty formatting
        logProviderRequest('gemini', requestPayload as unknown as Record<string, unknown>, {
          streaming: true,
        });

        // Use the streaming API
        const streamPromise = this.getGeminiClient().models.generateContentStream(requestPayload);

        // Mark that stream is created to prevent retries after this point
        streamCreated = true;

        try {
          let _content = '';
          let finalChunk: GenerateContentResponse | null = null;

          // Await the stream and iterate through the async generator
          const stream = await streamPromise;
          for await (const chunk of stream) {
            streamingStarted = true; // Mark that streaming has begun

            // Emit token events for real-time display
            if (chunk.text && typeof chunk.text === 'string') {
              _content += chunk.text;
              this.emit('token', { token: chunk.text });
            }

            finalChunk = chunk;
          }

          if (!finalChunk) {
            throw new Error('No data received from stream');
          }

          const response = this._parseResponse(finalChunk);

          // Log streaming response with pretty formatting
          logProviderResponse('gemini', finalChunk, { streaming: true });

          logger.debug('Received streaming response from Gemini', {
            provider: 'gemini',
            contentLength: response.content.length,
            toolCallCount: response.toolCalls.length,
            toolCallNames: response.toolCalls.map((tc: ToolCall) => tc.name),
            usage: response.usage,
          });

          // Emit completion event
          this.emit('complete', { response });

          return response;
        } catch (error) {
          const errorObj = error as Error;
          logger.error('Streaming error from Gemini', { error: errorObj.message });
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

  protected normalizeStopReason(stopReason: string | null | undefined): string | undefined {
    if (!stopReason) return undefined;

    switch (stopReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'FINISH_REASON_UNSPECIFIED':
        return 'stop';
      default:
        return 'stop';
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'gemini',
      displayName: 'Google Gemini',
      requiresApiKey: true,
      configurationHint: 'Set API key in provider settings',
    };
  }

  isConfigured(): boolean {
    const config = this._config as GeminiProviderConfig;
    return !!config.apiKey && config.apiKey.length > 0;
  }

  override isRecoverableError(error: unknown): boolean {
    // Use base implementation - Google AI SDK follows standard HTTP error patterns
    return super.isRecoverableError(error);
  }
}
