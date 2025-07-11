// ABOUTME: Tests for thread compaction functionality
// ABOUTME: Verifies tool result truncation and system message generation

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager.js';

describe('Thread Compaction', () => {
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    threadManager = new ThreadManager(':memory:');
    threadId = 'test-thread-compaction';
    threadManager.createThread(threadId);
  });

  it('should truncate long tool results to 200 words', () => {
    // Create a long tool result (300 words)
    const longOutput = Array(300).fill('word').join(' ');

    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'test-call',
      content: [{ type: 'text', text: longOutput }],
      isError: false,
    });

    threadManager.compact(threadId);

    const events = threadManager.getEvents(threadId);
    const toolResultEvent = events.find((e) => e.type === 'TOOL_RESULT');
    const toolResult = toolResultEvent?.data as any;

    expect(toolResult.content[0].text).toContain('... [truncated 100 more words of tool output]');
    expect(toolResult.content[0].text.split(' ').length).toBeLessThanOrEqual(210); // ~200 words + truncation message
  });

  it('should leave short tool results unchanged', () => {
    const shortOutput = 'This is a short output with only ten words here.';

    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'test-call',
      content: [{ type: 'text', text: shortOutput }],
      isError: false,
    });

    threadManager.compact(threadId);

    const events = threadManager.getEvents(threadId);
    const toolResultEvent = events.find((e) => e.type === 'TOOL_RESULT');
    const toolResult = toolResultEvent?.data as any;

    expect(toolResult.content[0].text).toBe(shortOutput); // Unchanged
  });

  it('should add system message after compaction with token savings', () => {
    // Start fresh
    threadManager = new ThreadManager(':memory:');
    threadId = 'test-thread-system-message';
    threadManager.createThread(threadId);

    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'test-call',
      content: [{ type: 'text', text: Array(300).fill('word').join(' ') }], // Long output
      isError: false,
    });

    const eventsBefore = threadManager.getEvents(threadId);
    expect(eventsBefore.length).toBe(1); // Sanity check

    threadManager.compact(threadId);
    const eventsAfter = threadManager.getEvents(threadId);

    expect(eventsAfter.length).toBe(2); // Should be 1 original + 1 system message

    const systemMessage = eventsAfter.find((e) => e.type === 'LOCAL_SYSTEM_MESSAGE');
    expect(systemMessage).toBeDefined();
    expect(systemMessage?.data).toContain('Compacted 1 tool results');
    expect(systemMessage?.data).toContain('save about');
    expect(systemMessage?.data).toContain('tokens');
  });

  it('should skip system messages in conversation building', () => {
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'test-call',
      content: [{ type: 'text', text: Array(300).fill('word').join(' ') }],
      isError: false,
    });

    threadManager.compact(threadId); // Adds system message

    const events = threadManager.getEvents(threadId);

    // Should have added a LOCAL_SYSTEM_MESSAGE about compaction
    const compactionMessage = events.find((e) => e.type === 'LOCAL_SYSTEM_MESSAGE');
    expect(compactionMessage).toBeDefined();
    expect(compactionMessage?.data).toContain('Compacted');
  });

  it('should handle multiple tool results', () => {
    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'call-1',
      content: [{ type: 'text', text: Array(300).fill('word').join(' ') }], // Long
      isError: false,
    });

    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'call-2',
      content: [{ type: 'text', text: 'Short output' }], // Short
      isError: false,
    });

    threadManager.compact(threadId);

    const events = threadManager.getEvents(threadId);
    const systemMessage = events.find((e) => e.type === 'LOCAL_SYSTEM_MESSAGE');

    expect(systemMessage?.data).toContain('Compacted 1 tool results'); // Only 1 was actually compacted
  });

  it('should report no tokens saved when no compaction occurs', () => {
    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'test-call',
      content: [{ type: 'text', text: 'Short output' }], // Under 200 words, won't be compacted
      isError: false,
    });

    threadManager.compact(threadId);

    const events = threadManager.getEvents(threadId);
    const systemMessage = events.find((e) => e.type === 'LOCAL_SYSTEM_MESSAGE');

    expect(systemMessage?.data).toContain('Compacted 0 tool results');
    expect(systemMessage?.data).toContain('to save tokens'); // Generic message when no specific token count
  });
});
