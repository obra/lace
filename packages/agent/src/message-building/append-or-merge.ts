// ABOUTME: Helper that appends user text into ProviderMessage[] either as a
// new role:'user' entry OR by merging into the last entry when it is already
// role:'user'. Prevents consecutive same-role messages from reaching the
// provider wire — Anthropic combines them in implementation-defined ways and
// the duplication disrupts cache reach.

import type { ProviderMessage } from '@lace/agent/providers/base-provider';

/**
 * Returns a new array with `text` appended as a user message. If the last
 * existing message is already role:'user', merges `text` into it instead of
 * pushing a new entry. The merge preserves any toolResults on the last
 * message — only `.content` gets the text added.
 *
 * For string content: joined with newline (or replaces it if existing is empty).
 * For array content: appended as a new text ContentBlock.
 *
 * IMPORTANT: when the last message carries toolResults,
 * merging text here puts text alongside tool_result on the user turn. The
 * wire format converter (`convertToAnthropicFormat`) MUST emit tool_result
 * BEFORE the text — Anthropic's API otherwise 400s with a misleading
 * "tool_use ids were found without tool_result blocks immediately after"
 * error even though the tool_result is present in the message. See the
 * load-bearing-invariant banner in format-converters.ts.
 */
export function appendOrMergeUser(messages: ProviderMessage[], text: string): ProviderMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    return [...messages, { role: 'user', content: text }];
  }

  const merged: ProviderMessage = { ...last };
  if (typeof last.content === 'string') {
    merged.content = last.content.length > 0 ? `${last.content}\n${text}` : text;
  } else {
    merged.content = [...last.content, { type: 'text', text }];
  }
  return [...messages.slice(0, -1), merged];
}
