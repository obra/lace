// ABOUTME: Type definitions for AI provider abstraction layer
// ABOUTME: Defines common interfaces for different AI model providers (Anthropic, LMStudio, etc.)

import { ProviderToolCall, ProviderToolResult, ProviderMessage } from './base-provider.js';

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





export interface StreamingEvents {
  token: { token: string };
  token_usage_update: {
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  error: { error: Error };
  complete: { response: ProviderResponse };
}