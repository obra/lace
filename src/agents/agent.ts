// ABOUTME: Core Agent class that handles model interactions, streaming, and function calling
// ABOUTME: Not a singleton - multiple agents can be instantiated for concurrent operations

import Anthropic from '@anthropic-ai/sdk';
import { Tool } from '../tools/types.js';

export interface AgentConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export class Agent {
  private readonly _anthropic: Anthropic;
  private readonly _config: Required<AgentConfig>;

  constructor(config: AgentConfig) {
    this._anthropic = new Anthropic({ apiKey: config.apiKey });
    this._config = {
      model: config.model || 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens || 4000,
      systemPrompt: config.systemPrompt || 'You are a helpful assistant.',
      ...config,
    };
  }

  async createResponse(
    messages: Anthropic.MessageParam[],
    tools: Tool[] = []
  ): Promise<AgentResponse> {
    // Convert our tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
    const response = await this._anthropic.messages.create({
      model: this._config.model,
      max_tokens: this._config.maxTokens,
      messages,
      system: this._config.systemPrompt,
      tools: anthropicTools,
    });

    const textContent = response.content
      .filter((content): content is Anthropic.TextBlock => content.type === 'text')
      .map((content) => content.text)
      .join('');

    const toolCalls = response.content
      .filter((content): content is Anthropic.ToolUseBlock => content.type === 'tool_use')
      .map((content) => ({
        id: content.id,
        name: content.name,
        input: content.input as Record<string, unknown>,
      }));

    return {
      content: textContent,
      toolCalls,
    };
  }
}
