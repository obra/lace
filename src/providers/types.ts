// ABOUTME: Type definitions for AI provider abstraction layer
// ABOUTME: Defines common interfaces for different AI model providers (Anthropic, LMStudio, etc.)

import { ProviderResponse } from './base-provider.js';

export interface StreamingEvents {
  token: { token: string };
  token_usage_update: {
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  error: { error: Error };
  complete: { response: ProviderResponse };
}
