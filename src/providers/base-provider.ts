// ABOUTME: Abstract base class for all AI providers
// ABOUTME: Defines the common interface and provides base functionality for providers

import { EventEmitter } from 'events';
import { Tool } from '../tools/types.js';


export interface ProviderConfig {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  streaming?: boolean; // Enable token-by-token streaming
  [key: string]: unknown; // Allow provider-specific config
}

export interface ProviderResponse {
  content: string;
  toolCalls: ProviderToolCall[];
  stopReason?: string; // Normalized: "max_tokens" | "stop" | "tool_use" | "error"
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  performance?: {
    // Unique value for local models
    tokensPerSecond?: number;
    timeToFirstToken?: number;
    totalDuration?: number;
  };
}

export abstract class AIProvider extends EventEmitter {
  protected readonly _config: ProviderConfig;
  protected _systemPrompt: string = '';

  constructor(config: ProviderConfig) {
    super();
    this._config = config;
  }

  abstract createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse>;

  // Optional streaming support - providers can override this
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Default implementation: fall back to non-streaming
    return this.createResponse(messages, tools, signal);
  }

  // Check if provider supports streaming
  get supportsStreaming(): boolean {
    return false; // Default to false, override in providers that support it
  }

  // Access to configuration for streaming checks
  get config(): ProviderConfig {
    return this._config;
  }

  // System prompt management
  setSystemPrompt(systemPrompt: string): void {
    this._systemPrompt = systemPrompt;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  abstract get providerName(): string;
  abstract get defaultModel(): string;

  get modelName(): string {
    return this._config.model || this.defaultModel;
  }

  // Token estimation utility for streaming
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // System prompt handling with fallback logic
  protected getEffectiveSystemPrompt(messages: ProviderMessage[]): string {
    const systemMessage = messages.find(msg => msg.role === 'system');
    return systemMessage?.content || this._systemPrompt || 'You are a helpful assistant.';
  }

  // Base stop reason normalization - providers should override for specific mappings
  protected normalizeStopReason(stopReason: string | null | undefined): string | undefined {
    if (!stopReason) return undefined;
    
    // Providers should override this method to handle their specific stop reasons
    // This base implementation provides a safe default
    return 'stop';
  }
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderToolResult {
  id: string;
  output: string;
  success: boolean;
  error?: string;
}

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ProviderToolCall[]; // For assistant messages with tool calls
  toolResults?: ProviderToolResult[]; // For user messages with tool results
}