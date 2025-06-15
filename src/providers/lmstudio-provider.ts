// ABOUTME: LMStudio provider implementation using local LMStudio server
// ABOUTME: Handles tool calling by parsing JSON from model responses since LMStudio may not support structured tool calls

import { LMStudioClient } from '@lmstudio/sdk';
import { AIProvider, ProviderMessage, ProviderResponse, ProviderConfig } from './types.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';

export interface LMStudioProviderConfig extends ProviderConfig {
  baseUrl?: string;
  verbose?: boolean;
}

export class LMStudioProvider extends AIProvider {
  private readonly _client: LMStudioClient;
  private readonly _verbose: boolean;
  private readonly _baseUrl: string;
  private _cachedModel: any = null;
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
    return 'deepseek/deepseek-r1-0528-qwen3-8b';
  }

  async diagnose(): Promise<{ connected: boolean; models: string[]; error?: string }> {
    try {
      process.stdout.write(`🔍 Connecting to LMStudio at ${this._baseUrl}...\n`);

      // Try to list loaded models to test connection
      const models = await this._client.llm.listLoaded();
      process.stdout.write(`✅ Connected successfully\n`);
      process.stdout.write(
        `📦 Loaded models (${models.length}): ${models.map((m) => m.identifier).join(', ')}\n`
      );

      return {
        connected: true,
        models: models.map((m) => m.identifier),
      };
    } catch (error: any) {
      process.stdout.write(`❌ Connection failed: ${error.message}\n`);
      return {
        connected: false,
        models: [],
        error: error.message,
      };
    }
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[] = []): Promise<ProviderResponse> {
    const modelId = this._config.model || this.defaultModel;

    // Check if we have a cached model for this modelId
    if (this._cachedModel && this._cachedModelId === modelId) {
      process.stdout.write(`✅ Using cached model "${modelId}"\n`);
    } else {
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
        process.stdout.write(`✅ Found already loaded model "${modelId}"\n`);
        // Get reference to existing loaded model from the list
        const loadedModels = await this._client.llm.listLoaded();
        const existingModel = loadedModels.find((m) => m.identifier === modelId);

        if (existingModel) {
          process.stdout.write(`✅ Using existing model instance "${modelId}"\n`);
          this._cachedModel = existingModel;
          this._cachedModelId = modelId;
        } else {
          throw new Error(`Model "${modelId}" appears loaded but could not retrieve instance`);
        }
      } else {
        process.stdout.write(
          `⚠️  Target model "${modelId}" not loaded. Available models: ${diagnostics.models.join(', ')}\n`
        );
        process.stdout.write(`🔄 Attempting to load "${modelId}"...\n`);

        try {
          this._cachedModel = await this._client.llm.load(modelId, { verbose: this._verbose });
          this._cachedModelId = modelId;
          process.stdout.write(`✅ Model "${modelId}" loaded successfully\n`);
        } catch (error: any) {
          // Provide helpful error messages based on the error type
          if (error.message?.includes('insufficient system resources')) {
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
                `Original error: ${error.message}`
            );
          } else if (
            error.message?.includes('ECONNREFUSED') ||
            error.message?.includes('Connection refused')
          ) {
            throw new Error(
              `Cannot connect to LMStudio server.\n` +
                `Make sure LMStudio is running and accessible at the configured URL.\n\n` +
                `To fix this:\n` +
                `  - Start LMStudio application\n` +
                `  - Ensure the server is running on ws://localhost:1234\n` +
                `  - Check firewall settings if using a remote server\n\n` +
                `Original error: ${error.message}`
            );
          } else if (
            error.message?.includes('Model not found') ||
            error.message?.includes('not available')
          ) {
            throw new Error(
              `Model "${modelId}" is not available in LMStudio.\n\n` +
                `To fix this:\n` +
                `  - Download the model in LMStudio\n` +
                `  - Check the model name is correct\n` +
                `  - Use --provider anthropic if LMStudio isn't set up\n\n` +
                `Original error: ${error.message}`
            );
          } else {
            throw new Error(
              `LMStudio connection failed: ${error.message}\n\n` +
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

    // Convert messages to LMStudio format
    const lmMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // If we have tools, add a system message explaining how to use them
    if (tools.length > 0) {
      const toolInstructions = this._buildToolInstructions(tools);

      // Check if there's already a system message
      const systemMessageIndex = lmMessages.findIndex((msg) => msg.role === 'system');
      if (systemMessageIndex >= 0) {
        lmMessages[systemMessageIndex].content += '\n\n' + toolInstructions;
      } else {
        lmMessages.unshift({
          role: 'system',
          content: toolInstructions,
        });
      }
    }

    // Log the request
    logger.debug('Sending request to LMStudio', {
      provider: 'lmstudio',
      model: modelId,
      messageCount: lmMessages.length,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      messages: lmMessages,
    });

    // Make the request using cached model
    const prediction = this._cachedModel.respond(lmMessages);

    let fullResponse = '';
    for await (const chunk of prediction) {
      if (chunk.content) {
        fullResponse += chunk.content;
      }
    }

    // Parse tool calls from the response
    const toolCalls = this._extractToolCalls(fullResponse);

    // Remove tool call JSON from the response content
    const cleanedContent = this._removeToolCallsFromContent(fullResponse);

    logger.debug('Received response from LMStudio', {
      provider: 'lmstudio',
      model: modelId,
      rawContentLength: fullResponse.length,
      cleanedContentLength: cleanedContent.length,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map((tc) => tc.name),
      rawContent: fullResponse,
    });

    return {
      content: cleanedContent.trim(),
      toolCalls,
    };
  }

  private _buildToolInstructions(tools: Tool[]): string {
    const toolDescriptions = tools
      .map((tool) => {
        return `- ${tool.name}: ${tool.description}\n  Parameters: ${JSON.stringify(tool.input_schema, null, 2)}`;
      })
      .join('\n');

    return `You have access to the following tools. When you need to use a tool, respond with a JSON object in this exact format:

\`\`\`json
{
  "name": "tool_name",
  "arguments": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

Available tools:
${toolDescriptions}

You can provide regular text response along with tool calls. If you need to call multiple tools, include multiple JSON blocks.`;
  }

  private _extractToolCalls(
    response: string
  ): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    // Look for JSON blocks in the response
    const jsonBlockRegex = /```json\s*\n?([\s\S]*?)\n?```/g;
    let match;
    let callId = 1;

    while ((match = jsonBlockRegex.exec(response)) !== null) {
      try {
        const jsonContent = match[1].trim();
        const parsed = JSON.parse(jsonContent);

        if (parsed.name && parsed.arguments) {
          toolCalls.push({
            id: `call_${callId++}`,
            name: parsed.name,
            input: parsed.arguments,
          });
        }
      } catch {
        // Ignore invalid JSON
        continue;
      }
    }

    // Also look for standalone JSON objects (without code blocks)
    // This regex finds JSON objects that contain both "name" and "arguments" fields
    const standaloneJsonRegex =
      /\{(?:[^{}]|\{[^{}]*\})*"name"(?:[^{}]|\{[^{}]*\})*"arguments"(?:[^{}]|\{[^{}]*\})*\}/g;
    let standaloneMatch;

    while ((standaloneMatch = standaloneJsonRegex.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(standaloneMatch[0]);

        if (parsed.name && parsed.arguments) {
          // Check if we already have this tool call (avoid duplicates)
          const isDuplicate = toolCalls.some(
            (tc) =>
              tc.name === parsed.name &&
              JSON.stringify(tc.input) === JSON.stringify(parsed.arguments)
          );

          if (!isDuplicate) {
            toolCalls.push({
              id: `call_${callId++}`,
              name: parsed.name,
              input: parsed.arguments,
            });
          }
        }
      } catch {
        // Ignore invalid JSON
        continue;
      }
    }

    return toolCalls;
  }

  private _removeToolCallsFromContent(response: string): string {
    // Remove JSON code blocks
    let cleaned = response.replace(/```json\s*\n?[\s\S]*?\n?```/g, '');

    // Remove standalone JSON objects that look like tool calls
    cleaned = cleaned.replace(
      /\{(?:[^{}]|\{[^{}]*\})*"name"(?:[^{}]|\{[^{}]*\})*"arguments"(?:[^{}]|\{[^{}]*\})*\}/g,
      ''
    );

    // Clean up extra whitespace but preserve single newlines
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

    return cleaned;
  }
}
