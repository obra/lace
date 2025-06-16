// ABOUTME: Type definitions for AI provider abstraction layer
// ABOUTME: Defines common interfaces for different AI model providers (Anthropic, LMStudio, etc.)

import { Tool } from '../tools/types.js';
import { EventEmitter } from 'events';

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
  streaming?: boolean; // Enable token-by-token streaming
  [key: string]: unknown; // Allow provider-specific config
}

export interface StreamingEvents {
  token: { token: string };
  error: { error: Error };
  complete: { response: ProviderResponse };
}

export abstract class AIProvider extends EventEmitter {
  protected readonly _config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this._config = config;
  }

  abstract createResponse(messages: ProviderMessage[], tools: Tool[]): Promise<ProviderResponse>;

  // Optional streaming support - providers can override this
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[]
  ): Promise<ProviderResponse> {
    // Default implementation: fall back to non-streaming
    return this.createResponse(messages, tools);
  }

  // Check if provider supports streaming
  get supportsStreaming(): boolean {
    return false; // Default to false, override in providers that support it
  }

  // Access to configuration for streaming checks
  get config(): ProviderConfig {
    return this._config;
  }

  abstract get providerName(): string;
  abstract get defaultModel(): string;
}
