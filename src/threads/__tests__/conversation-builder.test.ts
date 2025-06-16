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
      { 
        role: 'assistant', 
        content: "I'll list the files for you.",
        toolCalls: [{
          id: 'call_123',
          name: 'bash',
          input: { command: 'ls' }
        }]
      },
      {
        role: 'user',
        content: '',
        toolResults: [{
          id: 'call_123',
          output: '{"stdout":"file1.txt\\nfile2.txt","stderr":"","exitCode":0}',
          success: true,
          error: undefined
        }]
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

    // In the new format, orphaned tool results are preserved as toolResults
    const messages = buildConversationFromEvents(events);
    expect(messages).toEqual([{ 
      role: 'user', 
      content: '',
      toolResults: [{
        id: 'call_orphan',
        output: 'result',
        success: true,
        error: undefined
      }]
    }]);
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
        content: '',
        toolResults: [{
          id: 'call_123',
          output: 'Failed to execute command',
          success: false,
          error: 'Permission denied'
        }]
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
      { 
        role: 'assistant', 
        content: "I'll execute the echo command for you:",
        toolCalls: [{
          id: 'toolu_01RkT8GPyHVx4SDwZiaoacs8',
          name: 'bash',
          input: { command: "echo 'test'" }
        }]
      },
      {
        role: 'user',
        content: '',
        toolResults: [{
          id: 'toolu_01RkT8GPyHVx4SDwZiaoacs8',
          output: '{"stdout":"test\\n","stderr":"","exitCode":0}',
          success: true,
          error: undefined
        }]
      },
    ]);
  });

  it('should handle empty events array', () => {
    const messages = buildConversationFromEvents([]);
    expect(messages).toEqual([]);
  });

  describe('Bug: Tool call conversion issues', () => {
    it('should reproduce the orphaned tool call bug from lace_20250616_0iwlj5', () => {
      // This reproduces the exact sequence that caused the bug
      const events: ThreadEvent[] = [
        {
          id: 'evt_1750097268497_5gb123tln',
          threadId: 'lace_20250616_0iwlj5',
          type: 'USER_MESSAGE',
          timestamp: new Date('2025-06-16T18:07:48.497Z'),
          data: 'Can you look at what it would take to add tool call approvals to the product?',
        },
        {
          id: 'evt_1750097273170_w17ftvvg0',
          threadId: 'lace_20250616_0iwlj5',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2025-06-16T18:07:53.170Z'),
          data: "I'll analyze the codebase to understand the current architecture and what would be needed to add tool call approvals.",
        },
        {
          id: 'evt_1750097273172_q8ofka2kc',
          threadId: 'lace_20250616_0iwlj5',
          type: 'TOOL_CALL',
          timestamp: new Date('2025-06-16T18:07:53.172Z'),
          data: {
            toolName: 'file_list',
            input: { path: '.', recursive: true, maxDepth: 3 },
            callId: 'toolu_017uxLcvejrehiNNVtjPVibC',
          },
        },
        {
          id: 'evt_1750097273307_i3o44ues6',
          threadId: 'lace_20250616_0iwlj5',
          type: 'TOOL_RESULT',
          timestamp: new Date('2025-06-16T18:07:53.307Z'),
          data: {
            callId: 'toolu_017uxLcvejrehiNNVtjPVibC',
            output: 'dist/__tests__/\nsrc/__tests__/\n...', // truncated for brevity
            success: true,
          },
        },
        {
          id: 'evt_1750097282665_agent2',
          threadId: 'lace_20250616_0iwlj5',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2025-06-16T18:08:02.665Z'),
          data: 'Looking at the codebase structure...',
        },
        {
          id: 'evt_1750097282667_tool2',
          threadId: 'lace_20250616_0iwlj5',
          type: 'TOOL_CALL',
          timestamp: new Date('2025-06-16T18:08:02.667Z'),
          data: {
            toolName: 'file_list',
            input: { path: 'src', recursive: false },
            callId: 'toolu_01D5E6M6A8DbRDbvQ3gQz74T',
          },
        },
        {
          id: 'evt_1750097282670_result2',
          threadId: 'lace_20250616_0iwlj5',
          type: 'TOOL_RESULT',
          timestamp: new Date('2025-06-16T18:08:02.670Z'),
          data: {
            callId: 'toolu_01D5E6M6A8DbRDbvQ3gQz74T',
            output: 'src/agents/\nsrc/cli/\nsrc/config/\n...',
            success: true,
          },
        },
        // This is the problematic final message that looks like a tool call but isn't
        {
          id: 'evt_1750097292908_final',
          threadId: 'lace_20250616_0iwlj5',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2025-06-16T18:08:12.908Z'),
          data: '[Called tool: file_read with input: {"path":"src/tools/types.ts"}]',
        },
      ];

      const messages = buildConversationFromEvents(events);

      // The bug: the final message contains tool call syntax but is just text
      const finalMessage = messages[messages.length - 1];
      expect(finalMessage).toEqual({
        role: 'assistant',
        content: '[Called tool: file_read with input: {"path":"src/tools/types.ts"}]',
      });

      // This proves the conversation builder would send this malformed text back to the provider
      // instead of understanding it should be a real tool call
    });

    it('should demonstrate the problem with orphaned tool calls', () => {
      // Scenario: Tool call made but no result yet (e.g., agent crashed before tool execution)
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Read a file',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'I will read the file for you.',
        },
        {
          id: 'evt3',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'src/tools/types.ts' },
            callId: 'toolu_orphaned',
          },
        },
        // NO TOOL_RESULT - this is the orphaned tool call
      ];

      const messages = buildConversationFromEvents(events);

      // Fixed: Now preserves tool calls as structured data
      expect(messages).toEqual([
        { role: 'user', content: 'Read a file' },
        { 
          role: 'assistant', 
          content: 'I will read the file for you.',
          toolCalls: [{
            id: 'toolu_orphaned',
            name: 'file_read',
            input: { path: 'src/tools/types.ts' }
          }]
        },
      ]);

      // Now when this conversation is sent back to the provider:
      // - Assistant said: "I will read the file for you." with a pending tool call
      // - Provider can properly handle the tool call instead of seeing fake text
    });

    it('should NOT convert tool calls to text messages', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Read a file',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date(),
          data: 'I will read the file for you.',
        },
        {
          id: 'evt3',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'src/tools/types.ts' },
            callId: 'toolu_123',
          },
        },
        {
          id: 'evt4',
          threadId: 'thread1',
          type: 'TOOL_RESULT',
          timestamp: new Date(),
          data: {
            callId: 'toolu_123',
            output: 'export interface Tool { ... }',
            success: true,
          },
        },
      ];

      const messages = buildConversationFromEvents(events);

      // Fixed: Tool calls are preserved as structured data
      // Tool calls should NOT be converted to text messages like "[Called tool: ...]"
      // They should be preserved in a way that providers can handle properly
      
      // We expect NO text messages that look like tool calls
      const hasToolCallText = messages.some(msg => 
        typeof msg.content === 'string' && msg.content.includes('[Called tool:')
      );
      expect(hasToolCallText).toBe(false); // No fake text messages

      // We should have exactly 3 messages: user, assistant+toolCall, user+toolResult
      expect(messages).toHaveLength(3);

      expect(messages).toEqual([
        { role: 'user', content: 'Read a file' },
        { 
          role: 'assistant', 
          content: 'I will read the file for you.',
          toolCalls: [{
            id: 'toolu_123',
            name: 'file_read',
            input: { path: 'src/tools/types.ts' }
          }]
        },
        {
          role: 'user',
          content: '',
          toolResults: [{
            id: 'toolu_123',
            output: 'export interface Tool { ... }',
            success: true,
            error: undefined
          }]
        }
      ]);

      // The assistant message should contain proper tool call structure
      const assistantMessages = messages.filter(msg => msg.role === 'assistant');
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].content).toBe('I will read the file for you.');
      expect(assistantMessages[0].toolCalls).toBeDefined();
      expect(assistantMessages[0].toolCalls).toHaveLength(1);
    });

    it('should handle orphaned tool calls without creating fake text', () => {
      const events: ThreadEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread1',
          type: 'USER_MESSAGE',
          timestamp: new Date(),
          data: 'Read a file',
        },
        {
          id: 'evt2',
          threadId: 'thread1',
          type: 'TOOL_CALL',
          timestamp: new Date(),
          data: {
            toolName: 'file_read',
            input: { path: 'src/tools/types.ts' },
            callId: 'toolu_orphaned',
          },
        },
        // NO TOOL_RESULT - this is orphaned
      ];

      const messages = buildConversationFromEvents(events);

      // Fixed: Orphaned tool calls are now preserved as structured data
      const hasToolCallText = messages.some(msg => 
        typeof msg.content === 'string' && msg.content.includes('[Called tool:')
      );
      expect(hasToolCallText).toBe(false); // No fake text messages

      // Should have user message + assistant message with tool call
      expect(messages).toHaveLength(2);
      expect(messages).toEqual([
        { role: 'user', content: 'Read a file' },
        { 
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: 'toolu_orphaned',
            name: 'file_read',
            input: { path: 'src/tools/types.ts' }
          }]
        }
      ]);
    });
  });
});
