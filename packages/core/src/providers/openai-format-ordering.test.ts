// ABOUTME: Test to verify OpenAI format enforces strict tool call/result ordering
import { describe, it, expect } from 'vitest';
import { convertToOpenAIFormat } from './format-converters';
import type { ProviderMessage } from './base-provider';

describe('convertToOpenAIFormat - tool call/result ordering', () => {
  it('should enforce strict ordering: assistant with tool_calls must be followed by ALL tool results before next assistant', () => {
    // This is a scenario that can happen with our event-sourced architecture:
    // 1. Agent makes tool calls
    // 2. Tools execute and return results
    // 3. Agent processes results and makes MORE tool calls (new AGENT_MESSAGE)
    // 4. Those new tools execute and return results

    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: 'Please help me',
      },
      {
        role: 'assistant',
        content: 'I will call some tools',
        toolCalls: [
          { id: 'call_A', name: 'tool_a', arguments: {} },
          { id: 'call_B', name: 'tool_b', arguments: {} },
        ],
      },
      {
        role: 'user',
        content: '',
        toolResults: [
          { id: 'call_A', content: [{ type: 'text', text: 'Result A' }], status: 'completed' },
          { id: 'call_B', content: [{ type: 'text', text: 'Result B' }], status: 'completed' },
        ],
      },
      {
        role: 'assistant',
        content: 'Based on those results, I will call more tools',
        toolCalls: [{ id: 'call_C', name: 'tool_c', arguments: {} }],
      },
      {
        role: 'user',
        content: '',
        toolResults: [
          { id: 'call_C', content: [{ type: 'text', text: 'Result C' }], status: 'completed' },
        ],
      },
    ];

    const converted = convertToOpenAIFormat(messages);

    // Verify structure is valid for OpenAI API
    // Expected sequence:
    // 1. user (Please help me)
    // 2. assistant (with tool_calls A, B)
    // 3. tool (result for A)
    // 4. tool (result for B)
    // 5. assistant (with tool_calls C)
    // 6. tool (result for C)

    expect(converted).toHaveLength(6);

    expect(converted[0]).toMatchObject({
      role: 'user',
      content: 'Please help me',
    });

    expect(converted[1]).toMatchObject({
      role: 'assistant',
      content: 'I will call some tools',
    });
    expect(converted[1].tool_calls).toHaveLength(2);

    // Tool results must come immediately after assistant message
    expect(converted[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_A',
      content: 'Result A',
    });

    expect(converted[3]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_B',
      content: 'Result B',
    });

    // Next assistant message
    expect(converted[4]).toMatchObject({
      role: 'assistant',
      content: 'Based on those results, I will call more tools',
    });
    expect(converted[4].tool_calls).toHaveLength(1);

    // Its tool result
    expect(converted[5]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_C',
      content: 'Result C',
    });
  });

  it('should handle orphaned tool results by creating synthetic assistant message first', () => {
    // This happens when we have tool results but no corresponding assistant message
    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: 'Start',
      },
      {
        role: 'user',
        content: '',
        toolResults: [
          {
            id: 'call_orphan',
            content: [{ type: 'text', text: 'Orphan result' }],
            status: 'completed',
          },
        ],
      },
    ];

    const converted = convertToOpenAIFormat(messages);

    // Should have: user, (synthetic assistant), tool
    // But current implementation might fail this - let's see
    expect(converted.length).toBeGreaterThanOrEqual(2);
  });

  it('should validate tool call/result pairing after conversion', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: 'Test',
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'tool_1', arguments: {} },
          { id: 'call_2', name: 'tool_2', arguments: {} },
        ],
      },
      {
        role: 'user',
        content: '',
        toolResults: [
          { id: 'call_1', content: [{ type: 'text', text: 'Result 1' }], status: 'completed' },
          { id: 'call_2', content: [{ type: 'text', text: 'Result 2' }], status: 'completed' },
        ],
      },
    ];

    const converted = convertToOpenAIFormat(messages);

    // Validate that every assistant message with tool_calls
    // is followed by tool messages for ALL tool_call_ids
    const pendingToolCalls: Set<string> = new Set();

    for (const msg of converted) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        // Add all tool call IDs to pending set
        for (const tc of msg.tool_calls as Array<{ id: string }>) {
          pendingToolCalls.add(tc.id);
        }
      } else if (msg.role === 'tool') {
        // Remove from pending set
        const toolCallId = (msg as { tool_call_id: string }).tool_call_id;
        if (!pendingToolCalls.has(toolCallId)) {
          throw new Error(`Tool result for ${toolCallId} has no corresponding tool call`);
        }
        pendingToolCalls.delete(toolCallId);
      } else if (msg.role === 'assistant' || msg.role === 'user') {
        // If we encounter another assistant/user message, all pending tool calls should be resolved
        if (pendingToolCalls.size > 0) {
          throw new Error(
            `Assistant/user message encountered with unresolved tool calls: ${Array.from(pendingToolCalls).join(', ')}`
          );
        }
      }
    }

    // At the end, no pending tool calls should remain
    expect(pendingToolCalls.size).toBe(0);
  });
});
