// ABOUTME: Tests for appendOrMergeUser — prevents consecutive role:user messages
// by merging text into the last entry when it is already role:'user'.

import { describe, it, expect } from 'vitest';
import { appendOrMergeUser } from '../append-or-merge';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';

describe('appendOrMergeUser', () => {
  it('appends new user message when last is assistant', () => {
    const messages: ProviderMessage[] = [{ role: 'assistant', content: 'hi' }];
    const result = appendOrMergeUser(messages, 'hello');
    expect(result).toEqual([
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('merges text into last user message (string content) by joining with newline', () => {
    const messages: ProviderMessage[] = [{ role: 'user', content: 'first' }];
    const result = appendOrMergeUser(messages, 'second');
    expect(result).toEqual([{ role: 'user', content: 'first\nsecond' }]);
  });

  it('appends text block to last user message (array content)', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
    ];
    const result = appendOrMergeUser(messages, 'second');
    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ]);
  });

  it('merges into last user message with toolResults; empty content gets replaced', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: '',
        toolResults: [{ id: 't1', content: [{ type: 'text', text: 'r1' }], status: 'completed' }],
      },
    ];
    const result = appendOrMergeUser(messages, 'reminder');
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('user');
    expect(result[0]!.toolResults).toEqual(messages[0]!.toolResults);
    // Empty content → reminder replaces it
    expect(result[0]!.content).toBe('reminder');
  });

  it('appends new user message to empty array', () => {
    const result = appendOrMergeUser([], 'first');
    expect(result).toEqual([{ role: 'user', content: 'first' }]);
  });

  it('does not mutate the input array', () => {
    const messages: ProviderMessage[] = [{ role: 'user', content: 'original' }];
    const original = messages[0]!;
    appendOrMergeUser(messages, 'added');
    // The original message object must be unchanged
    expect(original.content).toBe('original');
    expect(messages).toHaveLength(1);
  });
});
