// ABOUTME: The scripted e2e test provider matches commands at the start of the last
// ABOUTME: user message; a subagent's leading sent_at meta line must not hide them.

import { describe, it, expect } from 'vitest';
import { TestAgentProvider } from '@lace/agent/runtime/test-provider';

describe('TestAgentProvider with a sent_at-stamped user message', () => {
  it('still recognizes an anchored delegation command after the meta line', async () => {
    const provider = new TestAgentProvider();
    const response = await provider.createResponse(
      [
        {
          role: 'user',
          content:
            '<message_meta sent_at="2026-10-21T16:24:06Z"/>\ndelegate request credential github',
        },
      ],
      [],
      'test-model'
    );
    expect(response.toolCalls[0]?.name).toBe('delegate');
    expect(response.toolCalls[0]?.arguments).toEqual({ prompt: 'request credential github' });
  });
});
