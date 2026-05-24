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
