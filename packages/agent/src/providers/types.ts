// ABOUTME: Type definitions for provider events and streaming
// ABOUTME: Defines StreamingEvents interface for type-safe event handling in tests

import { ProviderResponse } from './base-provider';

/**
 * Event payload types for provider streaming events.
 * Maps event names to their payload structure.
 */
export interface StreamingEvents {
  token: { token: string };
  token_usage_update: {
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  complete: { response: ProviderResponse };
  error: { error: Error };
  thinking_start: Record<string, never>;
  thinking_delta: { text: string };
  thinking_end: { tokens?: number };
}
