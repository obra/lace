#!/usr/bin/env node
// ABOUTME: Interactive CLI interface for the Lace AI coding assistant
// ABOUTME: Handles user input/output and orchestrates agent, tools, and thread management

import * as readline from 'readline';
import Anthropic from '@anthropic-ai/sdk';
import { Agent } from './agents/agent.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { BashTool } from './tools/implementations/bash.js';
import { ThreadManager } from './threads/thread.js';

// Initialize components
const apiKey = process.env.ANTHROPIC_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_KEY required');
  process.exit(1);
}

const agent = new Agent({
  apiKey,
  systemPrompt: 'You are a coding assistant. Use the bash tool to help with programming tasks.',
});

const toolRegistry = new ToolRegistry();
const toolExecutor = new ToolExecutor(toolRegistry);
const threadManager = new ThreadManager();

// Register tools
toolRegistry.registerTool(new BashTool());

// Create thread for this session
const threadId = `thread_${Date.now()}`;
threadManager.createThread(threadId);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Keep conversation state simple like the original
const conversation: Anthropic.MessageParam[] = [];

async function processMessage(userMessage: string): Promise<string> {
  if (userMessage.trim()) {
    // Add user message to thread and conversation
    threadManager.addEvent(threadId, 'USER_MESSAGE', userMessage);
    conversation.push({ role: 'user', content: userMessage });
  }

  // Get agent response with available tools
  const availableTools = toolRegistry.getAllTools();
  const response = await agent.createResponse(conversation, availableTools);

  // Build assistant message content (text + tool calls)
  const assistantContent: (Anthropic.TextBlock | Anthropic.ToolUseBlock)[] = [];
  if (response.content) {
    assistantContent.push({ type: 'text', text: response.content });
  }
  for (const toolCall of response.toolCalls) {
    assistantContent.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
    });
  }

  // Add agent response to conversation
  conversation.push({ role: 'assistant', content: assistantContent });

  // Add agent message to thread
  if (response.content) {
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);
  }

  // Handle tool calls
  if (response.toolCalls.length > 0) {
    for (const toolCall of response.toolCalls) {
      // Add tool call to thread
      threadManager.addEvent(threadId, 'TOOL_CALL', {
        toolName: toolCall.name,
        input: toolCall.input,
        callId: toolCall.id,
      });

      console.log(`\n🔧 Running: ${toolCall.name} with ${JSON.stringify(toolCall.input)}`);

      // Execute tool
      const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);

      // Add tool result to thread and conversation
      threadManager.addEvent(threadId, 'TOOL_RESULT', {
        callId: toolCall.id,
        output: result.output,
        success: result.success,
        error: result.error,
      });

      conversation.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: result.output }],
      });

      console.log(result.output);
    }

    // Recurse to get next response
    return processMessage('');
  }

  return response.content;
}

console.log('🤖 Lace Agent started. Type "exit" to quit.\n');
(async () => {
  while (true) {
    const input = await new Promise<string>((resolve) => rl.question('> ', resolve));
    if (input.toLowerCase() === 'exit') {
      rl.close();
      break;
    }
    if (input.trim()) {
      const response = await processMessage(input);
      if (response) console.log(`\n${response}\n`);
    }
  }
})().catch(console.error);
