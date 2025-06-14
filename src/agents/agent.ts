// ABOUTME: Core Agent class that handles model interactions, streaming, and function calling
// ABOUTME: Not a singleton - multiple agents can be instantiated for concurrent operations

import { AIProvider, ProviderMessage } from '../providers/types.js';
import { Tool } from '../tools/types.js';

export interface AgentConfig {
  provider: AIProvider;
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
  private readonly _provider: AIProvider;

  constructor(config: AgentConfig) {
    this._provider = config.provider;
  }

  async createResponse(messages: ProviderMessage[], tools: Tool[] = []): Promise<AgentResponse> {
    const response = await this._provider.createResponse(messages, tools);

    return {
      content: response.content,
      toolCalls: response.toolCalls,
    };
  }

  get providerName(): string {
    return this._provider.providerName;
  }
}
