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

  async diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> {
    try {
      process.stdout.write(`🔍 Connecting to Ollama at ${this._host}...\n`);

      // Try to list models to test connection
      const models = await this._ollama.list();
      process.stdout.write(`✅ Connected successfully\n`);
      process.stdout.write(
        `📦 Available models (${models.models.length}): ${models.models.map((m) => m.name).join(', ')}\n`
      );

      return {
        connected: true,
        models: models.models.map((m) => m.name),
      };
    } catch (error: unknown) {
      process.stdout.write(
        `❌ Connection failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return {
        connected: false,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[] = []): Promise<ProviderResponse> {
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
    const ollamaMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

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
    const response: ChatResponse = await this._ollama.chat(requestPayload);

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
    };
  }
}
