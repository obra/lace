// ABOUTME: Tests for the updated conversation builder with provider abstraction
// ABOUTME: Verifies correct conversion of events to provider-agnostic message format

import { describe, it, expect } from 'vitest';
import { ThreadEvent } from '../types.js';
import { buildConversationFromEvents } from '../conversation-builder.js';

describe('buildConversationFromEvents', () => {
  it('should handle simple user message and agent response', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'thread1',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'Hello!',
      },
      {
        id: 'evt2',
        threadId: 'thread1',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: 'Hi there!',
      },
    ];

    const messages = buildConversationFromEvents(events);

    expect(messages).toEqual([
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('should handle agent message with tool call and result', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'thread1',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: 'List files',
      },
      {
        id: 'evt2',
        threadId: 'thread1',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        data: "I'll list the files for you.",
      },
      {
        id: 'evt3',
        threadId: 'thread1',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: {
          toolName: 'bash',
          input: { command: 'ls' },
          callId: 'call_123',
        },
      },
      {
        id: 'evt4',
        threadId: 'thread1',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          callId: 'call_123',
          output: '{"stdout":"file1.txt\\nfile2.txt","stderr":"","exitCode":0}',
          success: true,
        },
      },
    ];

    const messages = buildConversationFromEvents(events);

    expect(messages).toEqual([
      { role: 'user', content: 'List files' },
      { role: 'assistant', content: "I'll list the files for you." },
      { role: 'assistant', content: '[Called tool: bash with input: {"command":"ls"}]' },
      {
        role: 'user',
        content:
          '[Tool result: SUCCESS - {"stdout":"file1.txt\\nfile2.txt","stderr":"","exitCode":0}]',
      },
    ]);
  });

  it('should throw error on unknown event types', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'thread1',
        type: 'UNKNOWN_TYPE' as any,
        timestamp: new Date(),
        data: 'something',
      },
    ];

    expect(() => buildConversationFromEvents(events)).toThrow('Unknown event type: UNKNOWN_TYPE');
  });

  it('should handle orphaned tool results gracefully', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'thread1',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          callId: 'call_orphan',
          output: 'result',
          success: true,
        },
      },
    ];

    // In the new format, orphaned tool results are just converted to messages
    const messages = buildConversationFromEvents(events);
    expect(messages).toEqual([{ role: 'user', content: '[Tool result: SUCCESS - result]' }]);
  });

  it('should handle tool result with error', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'thread1',
        type: 'TOOL_RESULT',
        timestamp: new Date(),
        data: {
          callId: 'call_123',
          output: 'Failed to execute command',
          success: false,
          error: 'Permission denied',
        },
      },
    ];

    const messages = buildConversationFromEvents(events);

    expect(messages).toEqual([
      {
        role: 'user',
        content: '[Tool result: ERROR - Failed to execute command (Error: Permission denied)]',
      },
    ]);
  });

  it('should handle real event structure from logging', () => {
    const events: ThreadEvent[] = [
      {
        id: 'evt_1749919594120_x68q4xiny',
        threadId: 'thread_1749919594119',
        type: 'USER_MESSAGE',
        timestamp: new Date('2025-06-14T16:46:34.120Z'),
        data: "echo 'test'",
      },
      {
        id: 'evt_1749919597691_vqbexi0hk',
        threadId: 'thread_1749919594119',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2025-06-14T16:46:37.691Z'),
        data: "I'll execute the echo command for you:",
      },
      {
        id: 'evt_1749919597691_iwoe9wysk',
        threadId: 'thread_1749919594119',
        type: 'TOOL_CALL',
        timestamp: new Date('2025-06-14T16:46:37.691Z'),
        data: {
          toolName: 'bash',
          input: {
            command: "echo 'test'",
          },
          callId: 'toolu_01RkT8GPyHVx4SDwZiaoacs8',
        },
      },
      {
        id: 'evt_1749919597692_result',
        threadId: 'thread_1749919594119',
        type: 'TOOL_RESULT',
        timestamp: new Date('2025-06-14T16:46:37.692Z'),
        data: {
          callId: 'toolu_01RkT8GPyHVx4SDwZiaoacs8',
          output: '{"stdout":"test\\n","stderr":"","exitCode":0}',
          success: true,
        },
      },
    ];

    const messages = buildConversationFromEvents(events);

    expect(messages).toEqual([
      { role: 'user', content: "echo 'test'" },
      { role: 'assistant', content: "I'll execute the echo command for you:" },
      { role: 'assistant', content: '[Called tool: bash with input: {"command":"echo \'test\'"}]' },
      {
        role: 'user',
        content: '[Tool result: SUCCESS - {"stdout":"test\\n","stderr":"","exitCode":0}]',
      },
    ]);
  });

  it('should handle empty events array', () => {
    const messages = buildConversationFromEvents([]);
    expect(messages).toEqual([]);
  });
});
