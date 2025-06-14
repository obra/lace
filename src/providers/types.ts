// ABOUTME: Type definitions for AI provider abstraction layer
// ABOUTME: Defines common interfaces for different AI model providers (Anthropic, LMStudio, etc.)

import { Tool } from '../tools/types.js';

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderResponse {
  content: string;
  toolCalls: ProviderToolCall[];
}

export interface ProviderConfig {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  [key: string]: unknown; // Allow provider-specific config
}

export abstract class AIProvider {
  protected readonly _config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this._config = config;
  }

  abstract createResponse(messages: ProviderMessage[], tools: Tool[]): Promise<ProviderResponse>;

  abstract get providerName(): string;
  abstract get defaultModel(): string;
}
