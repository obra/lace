// ABOUTME: Integration tests for conversation state management across multiple turns
// ABOUTME: Tests the full conversation flow to catch context truncation bugs

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../agents/agent.js';
import { LMStudioProvider } from '../providers/lmstudio-provider.js';
import { ThreadManager } from '../threads/thread.js';
import { buildConversationFromEvents } from '../threads/conversation-builder.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutor } from '../tools/executor.js';
import { BashTool } from '../tools/implementations/bash.js';

// These tests use LMStudio heavily since it's local and free
describe('Conversation State Management', () => {
  let provider: LMStudioProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolRegistry: ToolRegistry;
  let toolExecutor: ToolExecutor;
  let threadId: string;

  beforeEach(async () => {
    provider = new LMStudioProvider({
      systemPrompt: 'You are a helpful coding assistant. Use tools when appropriate.',
    });

    // Skip tests if LMStudio is not available
    try {
      const diagnostics = await provider.diagnose();
      if (!diagnostics.connected) {
        console.log('Skipping LMStudio tests - server not available');
        return;
      }
    } catch (error) {
      console.log('Skipping LMStudio tests - connection failed:', error);
      return;
    }

    agent = new Agent({ provider });
    threadManager = new ThreadManager();
    toolRegistry = new ToolRegistry();
    toolExecutor = new ToolExecutor(toolRegistry);

    toolRegistry.registerTool(new BashTool());

    threadId = `test_thread_${Date.now()}`;
    threadManager.createThread(threadId);
  });

  it('should maintain conversation context across multiple tool calls', async () => {
    const availableTools = toolRegistry.getAllTools();

    // Turn 1: Ask for directory listing
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'List the files in the current directory');

    let events = threadManager.getEvents(threadId);
    let conversation = buildConversationFromEvents(events);

    console.log(`Turn 1 - Message count: ${conversation.length}`);
    expect(conversation.length).toBe(1); // Just user message

    let response = await agent.createResponse(conversation, availableTools);
    expect(response.toolCalls.length).toBeGreaterThan(0);

    // Add agent response and tool execution
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);

    for (const toolCall of response.toolCalls) {
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
      });

      const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        callId: toolCall.id,
        output: result.output,
        success: result.success,
        error: result.error,
      });
    }

    // Turn 2: Ask follow-up question
    threadManager.addEvent(
      threadId,
      'USER_MESSAGE',
      'What programming language is this project written in?'
    );

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);

    console.log(`Turn 2 - Message count: ${conversation.length}, Event count: ${events.length}`);
    expect(conversation.length).toBeGreaterThan(3); // Should have multiple messages by now
    expect(events.length).toBeGreaterThanOrEqual(5); // Should have multiple events

    response = await agent.createResponse(conversation, availableTools);
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);

    // Execute any tool calls from Turn 2
    for (const toolCall of response.toolCalls) {
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
      });

      const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        callId: toolCall.id,
        output: result.output,
        success: result.success,
        error: result.error,
      });
    }

    // Turn 3: Ask another question that requires tool use
    threadManager.addEvent(
      threadId,
      'USER_MESSAGE',
      'Run the command "echo hello world" and show me the output'
    );

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);

    console.log(`Turn 3 - Message count: ${conversation.length}, Event count: ${events.length}`);
    expect(conversation.length).toBeGreaterThan(5); // Should keep growing
    expect(events.length).toBeGreaterThanOrEqual(7); // Should keep growing (1 user + 1 agent + 2 tool + 1 user + 1 agent + 1 user = 7 minimum)

    response = await agent.createResponse(conversation, availableTools);
    expect(response.toolCalls.length).toBeGreaterThan(0);

    // Add the tool execution
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);

    for (const toolCall of response.toolCalls) {
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
      });

      const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        callId: toolCall.id,
        output: result.output,
        success: result.success,
        error: result.error,
      });
    }

    // Turn 4: Ask a question that should reference previous context
    threadManager.addEvent(
      threadId,
      'USER_MESSAGE',
      'Based on what you just saw, what kind of project is this?'
    );

    events = threadManager.getEvents(threadId);
    conversation = buildConversationFromEvents(events);

    console.log(`Turn 4 - Message count: ${conversation.length}, Event count: ${events.length}`);
    expect(conversation.length).toBeGreaterThan(8); // Should be substantial by now
    expect(events.length).toBeGreaterThanOrEqual(11); // Should have many events

    response = await agent.createResponse(conversation, availableTools);

    // The response should reference previous information, not ask to run tools again
    expect(response.content.toLowerCase()).not.toContain('let me list');
    expect(response.content.toLowerCase()).not.toContain('let me check');

    // Verify the conversation contains the full history
    const userMessages = conversation.filter((msg) => msg.role === 'user');
    console.log('User message count:', userMessages.length);
    expect(userMessages.length).toBeGreaterThanOrEqual(6); // At least 4 user messages + tool results

    // Check for specific content from previous turns
    const fullConversationText = conversation.map((msg) => msg.content).join(' ');
    expect(fullConversationText).toContain('List the files');
    expect(fullConversationText).toContain('programming language');
    expect(fullConversationText).toContain('package.json');
    expect(fullConversationText).toContain('what kind of project');
  }, 60000); // Long timeout for LMStudio responses

  it('should handle rapid-fire tool calls without losing context', async () => {
    const availableTools = toolRegistry.getAllTools();
    const commands = ['pwd', 'ls', 'cat package.json | head -5', 'echo "test"', 'date'];

    let expectedMessageCount = 0; // Start with 0

    for (let i = 0; i < commands.length; i++) {
      threadManager.addEvent(threadId, 'USER_MESSAGE', `Run this command: ${commands[i]}`);
      expectedMessageCount += 1; // User message

      const events = threadManager.getEvents(threadId);
      const conversation = buildConversationFromEvents(events);

      console.log(
        `Command ${i + 1} - Message count: ${conversation.length}, Expected: ${expectedMessageCount}`
      );
      expect(conversation.length).toBe(expectedMessageCount);

      const response = await agent.createResponse(conversation, availableTools);
      expect(response.toolCalls.length).toBeGreaterThan(0);

      threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);
      expectedMessageCount += 1; // Agent message

      for (const toolCall of response.toolCalls) {
        threadManager.addEvent(threadId, 'TOOL_CALL', {
          toolName: toolCall.name,
          input: toolCall.input,
          callId: toolCall.id,
        });

        const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);
        threadManager.addEvent(threadId, 'TOOL_RESULT', {
          callId: toolCall.id,
          output: result.output,
          success: result.success,
          error: result.error,
        });

        expectedMessageCount += 2; // Tool call + tool result messages
      }

      // Verify message count keeps growing
      const updatedEvents = threadManager.getEvents(threadId);
      const updatedConversation = buildConversationFromEvents(updatedEvents);
      expect(updatedConversation.length).toBe(expectedMessageCount);
    }
  }, 120000); // Extra long timeout for multiple LMStudio calls

  it('should preserve conversation state across process simulation', async () => {
    const availableTools = toolRegistry.getAllTools();

    // Simulate a multi-turn conversation
    const turns = [
      'What files are in this directory?',
      'Look at the package.json file',
      'What dependencies does this project have?',
      'Check if there are any TypeScript files',
      'Tell me about the project structure based on what you found',
    ];

    let previousMessageCount = 0;

    for (let i = 0; i < turns.length; i++) {
      threadManager.addEvent(threadId, 'USER_MESSAGE', turns[i]);

      const events = threadManager.getEvents(threadId);
      const conversation = buildConversationFromEvents(events);

      console.log(`Turn ${i + 1}:`);
      console.log(`  User message: "${turns[i]}"`);
      console.log(`  Message count: ${conversation.length}`);
      console.log(`  Event count: ${events.length}`);

      // Message count should always increase
      expect(conversation.length).toBeGreaterThan(previousMessageCount);
      previousMessageCount = conversation.length;

      const response = await agent.createResponse(conversation, availableTools);
      threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);

      // Execute any tool calls
      for (const toolCall of response.toolCalls) {
        threadManager.addEvent(threadId, 'TOOL_CALL', {
          toolName: toolCall.name,
          input: toolCall.input,
          callId: toolCall.id,
        });

        const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);
        threadManager.addEvent(threadId, 'TOOL_RESULT', {
          callId: toolCall.id,
          output: result.output,
          success: result.success,
          error: result.error,
        });
      }

      // Verify all previous user messages are still in conversation
      const updatedEvents = threadManager.getEvents(threadId);
      const updatedConversation = buildConversationFromEvents(updatedEvents);
      const userMessages = updatedConversation.filter(
        (msg) => msg.role === 'user' && !msg.content.startsWith('[Tool result:')
      );

      expect(userMessages.length).toBe(i + 1);

      // Check that specific past messages are still there
      for (let j = 0; j <= i; j++) {
        const foundMessage = userMessages.find((msg) => msg.content === turns[j]);
        expect(foundMessage).toBeDefined();
      }
    }
  }, 180000); // Very long timeout for extended conversation

  it('should handle malformed events gracefully', async () => {
    // Add normal message
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'List files');

    // Add malformed event (this should be handled gracefully)
    try {
      threadManager.addEvent(threadId, 'INVALID_TYPE' as any, 'bad data');
    } catch (error) {
      console.log('Expected malformed event error:', error);
    }

    // Add another normal message
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'What is this project?');

    const events = threadManager.getEvents(threadId);

    // Should gracefully handle the malformed event
    expect(() => {
      buildConversationFromEvents(events);
    }).toThrow(); // Should fail fast on unknown event types

    // But if we filter out bad events, it should work
    const validEvents = events.filter((e) =>
      ['USER_MESSAGE', 'AGENT_MESSAGE', 'TOOL_CALL', 'TOOL_RESULT'].includes(e.type)
    );
    const conversation = buildConversationFromEvents(validEvents);
    expect(conversation.length).toBe(2); // Two valid user messages
  });
});
