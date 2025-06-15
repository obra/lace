// ABOUTME: Tests specifically targeting the conversation context truncation bug
// ABOUTME: Verifies that buildConversationFromEvents preserves full history

import { describe, it, expect } from 'vitest';
import { ThreadManager } from '../thread.js';
import { buildConversationFromEvents } from '../conversation-builder.js';
import type { ThreadEvent } from '../types.js';

describe('Conversation Context Preservation', () => {
  it('should preserve all messages in long conversations', () => {
    const threadManager = new ThreadManager();
    const threadId = 'test_thread';
    threadManager.createThread(threadId);

    // Simulate the exact scenario from the debug logs
    const interactions = [
      {
        user: 'Can you list the files in the current directory?',
        agent: "I'll list the files for you.",
      },
      {
        user: "can you explore the code for the project (in src) and tell me what does and doesn't make sense?",
        agent: 'I can help explore the structure...',
      },
      {
        user: 'please do dig through all the files',
        agent: 'I can certainly help by exploring...',
      },
      { user: 'go ahead', agent: "Okay, let's proceed systematically..." },
    ];

    let expectedMessageCount = 0;

    interactions.forEach((interaction, index) => {
      // Add user message
      threadManager.addEvent(threadId, 'USER_MESSAGE', interaction.user);
      expectedMessageCount += 1;

      // Add agent message
      threadManager.addEvent(threadId, 'AGENT_MESSAGE', interaction.agent);
      expectedMessageCount += 1;

      // Add some tool calls and results to make it realistic
      if (index < 2) {
        // First two interactions have tool calls
        threadManager.addEvent(threadId, 'TOOL_CALL', {
          toolName: 'bash',
          input: { command: index === 0 ? 'ls' : 'ls src/' },
          callId: `call_${index}`,
        });
        expectedMessageCount += 1; // Tool call message

        threadManager.addEvent(threadId, 'TOOL_RESULT', {
          callId: `call_${index}`,
          output:
            index === 0
              ? '{"stdout":"file1.txt\\nfile2.txt","stderr":"","exitCode":0}'
              : '{"stdout":"agents\\nproviders\\ntools","stderr":"","exitCode":0}',
          success: true,
        });
        expectedMessageCount += 1; // Tool result message
      }

      // Check that conversation length matches expected
      const events = threadManager.getEvents(threadId);
      const conversation = buildConversationFromEvents(events);

      console.log(`After interaction ${index + 1}:`);
      console.log(`  Events: ${events.length}`);
      console.log(`  Messages: ${conversation.length}`);
      console.log(`  Expected: ${expectedMessageCount}`);

      expect(conversation.length).toBe(expectedMessageCount);

      // Verify all previous user messages are still there
      const userMessages = conversation.filter(
        (msg) => msg.role === 'user' && !msg.content.startsWith('[Tool result:')
      );
      expect(userMessages.length).toBe(index + 1);

      // Check specific content is preserved
      for (let i = 0; i <= index; i++) {
        const found = userMessages.some((msg) => msg.content === interactions[i].user);
        expect(found).toBe(true);
      }
    });
  });

  it('should handle the exact message pattern from debug logs', () => {
    const threadManager = new ThreadManager();
    const threadId = 'debug_reproduction';
    threadManager.createThread(threadId);

    // Recreate the exact pattern that caused the bug
    // Turn 1: 2 messages
    threadManager.addEvent(
      threadId,
      'USER_MESSAGE',
      'Can you list the files in the current directory?'
    );
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', "I'll list the files for you.");

    let events = threadManager.getEvents(threadId);
    let conversation = buildConversationFromEvents(events);
    expect(conversation.length).toBe(2);

    // Add tool call and result
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      toolName: 'bash',
      input: { command: 'ls' },
      callId: 'call_1',
    });
    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      callId: 'call_1',
      output: 'file1.txt\nfile2.txt',
      success: true,
    });

    // Turn 2: Should be 5 messages total (user, agent, tool_call, tool_result, recursive_response)
    threadManager.addEvent(
      threadId,
      'AGENT_MESSAGE',
      'The files in the current directory are: file1.txt, file2.txt'
    );

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);
    expect(conversation.length).toBe(5);

    // Turn 3: Add another user message
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'can you explore the code for the project?');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'I can help explore the structure...');

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);
    expect(conversation.length).toBe(7);

    // Turn 4: Should continue growing, NOT reset to 10 like in the bug
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'please do dig through all the files');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'I can certainly help...');
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      toolName: 'bash',
      input: { command: 'ls src/' },
      callId: 'call_2',
    });
    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      callId: 'call_2',
      output: 'agents\nproviders\ntools',
      success: true,
    });

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);

    // This should be 11 messages, NOT 10 like in the bug
    expect(conversation.length).toBe(11);

    // Turn 5: Final turn should be even longer
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'go ahead');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', "Okay, let's proceed systematically...");

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);

    // This should be 13 messages, NOT 14 like in the truncated bug
    expect(conversation.length).toBe(13);

    // Verify that ALL original user messages are still present
    const userMessages = conversation.filter(
      (msg) => msg.role === 'user' && !msg.content.startsWith('[Tool result:')
    );
    expect(userMessages.length).toBe(4);

    const userTexts = userMessages.map((msg) => msg.content);
    expect(userTexts).toContain('Can you list the files in the current directory?');
    expect(userTexts).toContain('can you explore the code for the project?');
    expect(userTexts).toContain('please do dig through all the files');
    expect(userTexts).toContain('go ahead');
  });

  it('should handle tool calls and results correctly in sequence', () => {
    const threadManager = new ThreadManager();
    const threadId = 'tool_sequence_test';
    threadManager.createThread(threadId);

    // Start with user message
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'Run some commands');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', "I'll run commands for you");

    let events = threadManager.getEvents(threadId);
    let conversation = buildConversationFromEvents(events);
    expect(conversation.length).toBe(2);

    // Add multiple tool calls
    const toolCalls = [
      { name: 'bash', input: { command: 'pwd' }, callId: 'call_1' },
      { name: 'bash', input: { command: 'ls' }, callId: 'call_2' },
      { name: 'bash', input: { command: 'date' }, callId: 'call_3' },
    ];

    toolCalls.forEach((toolCall, index) => {
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.callId,
      });

      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        callId: toolCall.callId,
        output: `Result for ${toolCall.input.command}`,
        success: true,
      });

      events = threadManager.getEvents(threadId);
      conversation = buildConversationFromEvents(events);

      // Should have: user + agent + (tool_call + tool_result) * (index + 1)
      const expectedLength = 2 + (index + 1) * 2;
      expect(conversation.length).toBe(expectedLength);
    });

    // Add final agent response
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'All commands completed');

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);

    // Final count: 2 initial + 6 tool messages + 1 final = 9
    expect(conversation.length).toBe(9);

    // Verify the structure
    expect(conversation[0].role).toBe('user');
    expect(conversation[1].role).toBe('assistant');
    expect(conversation[2].role).toBe('assistant'); // First tool call
    expect(conversation[3].role).toBe('user'); // First tool result
    expect(conversation[4].role).toBe('assistant'); // Second tool call
    expect(conversation[5].role).toBe('user'); // Second tool result
    expect(conversation[6].role).toBe('assistant'); // Third tool call
    expect(conversation[7].role).toBe('user'); // Third tool result
    expect(conversation[8].role).toBe('assistant'); // Final response
  });

  it('should preserve event ordering and not lose any events', () => {
    const events: ThreadEvent[] = [];
    const threadId = 'ordering_test';

    // Create a complex sequence manually
    const eventSequence = [
      { type: 'USER_MESSAGE', data: 'Message 1' },
      { type: 'AGENT_MESSAGE', data: 'Response 1' },
      { type: 'TOOL_CALL', data: { toolName: 'bash', input: { command: 'ls' }, callId: 'call_1' } },
      { type: 'TOOL_RESULT', data: { callId: 'call_1', output: 'result1', success: true } },
      { type: 'USER_MESSAGE', data: 'Message 2' },
      { type: 'AGENT_MESSAGE', data: 'Response 2' },
      {
        type: 'TOOL_CALL',
        data: { toolName: 'bash', input: { command: 'pwd' }, callId: 'call_2' },
      },
      { type: 'TOOL_RESULT', data: { callId: 'call_2', output: 'result2', success: true } },
      { type: 'AGENT_MESSAGE', data: 'Final response' },
    ];

    eventSequence.forEach((eventData, index) => {
      events.push({
        id: `event_${index}`,
        threadId,
        type: eventData.type as any,
        timestamp: new Date(Date.now() + index * 1000), // Ensure ordering
        data: eventData.data,
      });
    });

    const conversation = buildConversationFromEvents(events);

    // Should convert to 9 messages
    expect(conversation.length).toBe(9);

    // Check the exact sequence
    expect(conversation[0]).toEqual({ role: 'user', content: 'Message 1' });
    expect(conversation[1]).toEqual({ role: 'assistant', content: 'Response 1' });
    expect(conversation[2]).toEqual({
      role: 'assistant',
      content: '[Called tool: bash with input: {"command":"ls"}]',
    });
    expect(conversation[3]).toEqual({ role: 'user', content: '[Tool result: SUCCESS - result1]' });
    expect(conversation[4]).toEqual({ role: 'user', content: 'Message 2' });
    expect(conversation[5]).toEqual({ role: 'assistant', content: 'Response 2' });
    expect(conversation[6]).toEqual({
      role: 'assistant',
      content: '[Called tool: bash with input: {"command":"pwd"}]',
    });
    expect(conversation[7]).toEqual({ role: 'user', content: '[Tool result: SUCCESS - result2]' });
    expect(conversation[8]).toEqual({ role: 'assistant', content: 'Final response' });
  });

  it('should handle conversation rebuild after simulated process restart', () => {
    // Simulate saving and reloading events as if process restarted
    const originalEvents: ThreadEvent[] = [
      {
        id: 'evt1',
        threadId: 'restart_test',
        type: 'USER_MESSAGE',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        data: 'Hello',
      },
      {
        id: 'evt2',
        threadId: 'restart_test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2025-01-01T10:00:01Z'),
        data: 'Hi there!',
      },
      {
        id: 'evt3',
        threadId: 'restart_test',
        type: 'USER_MESSAGE',
        timestamp: new Date('2025-01-01T10:00:02Z'),
        data: 'What can you do?',
      },
      {
        id: 'evt4',
        threadId: 'restart_test',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2025-01-01T10:00:03Z'),
        data: 'I can help with various tasks.',
      },
    ];

    // Serialize and deserialize (simulating persistence)
    const serialized = JSON.stringify(originalEvents);
    const deserializedEvents: ThreadEvent[] = JSON.parse(serialized);

    // Rebuild conversation
    const conversation = buildConversationFromEvents(deserializedEvents);

    expect(conversation.length).toBe(4);
    expect(conversation[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(conversation[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
    expect(conversation[2]).toEqual({ role: 'user', content: 'What can you do?' });
    expect(conversation[3]).toEqual({
      role: 'assistant',
      content: 'I can help with various tasks.',
    });
  });
});
