// ABOUTME: LMStudio provider implementation using local LMStudio server
// ABOUTME: Handles tool calling by parsing JSON from model responses since LMStudio may not support structured tool calls

import { LMStudioClient } from '@lmstudio/sdk';
import { AIProvider, ProviderMessage, ProviderResponse, ProviderConfig } from './types.js';
import { Tool } from '../tools/types.js';

export interface LMStudioProviderConfig extends ProviderConfig {
  baseUrl?: string;
  verbose?: boolean;
}

export class LMStudioProvider extends AIProvider {
  private readonly _client: LMStudioClient;
  private readonly _verbose: boolean;

  constructor(config: LMStudioProviderConfig = {}) {
    super(config);
    this._client = new LMStudioClient({
      baseUrl: config.baseUrl || 'ws://localhost:1234',
    });
    this._verbose = config.verbose ?? false;
  }

  get providerName(): string {
    return 'lmstudio';
  }

  get defaultModel(): string {
    return 'deepseek/deepseek-r1-0528-qwen3-8b';
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[] = []): Promise<ProviderResponse> {
    // Load the model
    const modelId = this._config.model || this.defaultModel;
    const model = await this._client.llm.load(modelId, { verbose: this._verbose });

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

    // Make the request
    const prediction = model.respond(lmMessages);

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
