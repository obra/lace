// ABOUTME: Materializes request-only text without mutating canonical conversation history.
import type { ProviderMessage } from './base-provider';

export function appendTemporaryContext(
  messages: ProviderMessage[],
  text: string | null | undefined
): ProviderMessage[] {
  return text ? [...messages, { role: 'user', content: text }] : messages;
}
