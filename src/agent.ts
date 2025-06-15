#!/usr/bin/env node
// ABOUTME: Interactive CLI interface for the Lace AI coding assistant
// ABOUTME: Handles user input/output and orchestrates agent, tools, and thread management

import * as readline from 'readline';
import { Agent } from './agents/agent.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { LMStudioProvider } from './providers/lmstudio-provider.js';
import { AIProvider } from './providers/types.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { BashTool } from './tools/implementations/bash.js';
import { ThreadManager } from './threads/thread.js';
import { buildConversationFromEvents } from './threads/conversation-builder.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    provider: 'anthropic' as 'anthropic' | 'lmstudio',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--provider' || arg === '-p') {
      const providerValue = args[i + 1];
      if (!providerValue || !['anthropic', 'lmstudio'].includes(providerValue)) {
        console.error('Error: --provider must be "anthropic" or "lmstudio"');
        process.exit(1);
      }
      options.provider = providerValue as 'anthropic' | 'lmstudio';
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--provider=')) {
      const providerValue = arg.split('=')[1];
      if (!['anthropic', 'lmstudio'].includes(providerValue)) {
        console.error('Error: --provider must be "anthropic" or "lmstudio"');
        process.exit(1);
      }
      options.provider = providerValue as 'anthropic' | 'lmstudio';
    } else {
      console.error(`Error: Unknown argument "${arg}"`);
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Lace AI Coding Assistant

Usage: lace [options]

Options:
  -h, --help                Show this help message
  -p, --provider <name>     Choose AI provider: "anthropic" (default) or "lmstudio"

Examples:
  lace                      # Use Anthropic Claude (default)
  lace --provider anthropic # Use Anthropic Claude explicitly
  lace --provider lmstudio  # Use local LMStudio server

Environment Variables:
  ANTHROPIC_KEY            Required for Anthropic provider
`);
}

// Parse arguments
const options = parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

// Create provider based on CLI option
async function createProvider(providerType: 'anthropic' | 'lmstudio'): Promise<AIProvider> {
  const systemPrompt =
    'You are a coding assistant. Use the bash tool to help with programming tasks.';

  switch (providerType) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_KEY;
      if (!apiKey) {
        console.error('Error: ANTHROPIC_KEY environment variable required for Anthropic provider');
        process.exit(1);
      }
      return new AnthropicProvider({ apiKey, systemPrompt });
    }
    case 'lmstudio': {
      return new LMStudioProvider({ systemPrompt });
    }
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }
}

async function main() {
  const provider = await createProvider(options.provider);
  const agent = new Agent({ provider });

  const toolRegistry = new ToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);
  const threadManager = new ThreadManager();

  // Register tools
  toolRegistry.registerTool(new BashTool());

  // Create thread for this session
  const threadId = `thread_${Date.now()}`;
  threadManager.createThread(threadId);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  async function processMessage(userMessage: string): Promise<string> {
    if (userMessage.trim()) {
      // Add user message to thread
      threadManager.addEvent(threadId, 'USER_MESSAGE', userMessage);
    }

    // Rebuild conversation from thread events
    const events = threadManager.getEvents(threadId);
    const conversation = buildConversationFromEvents(events);

    // Get agent response with available tools
    const availableTools = toolRegistry.getAllTools();
    let response;

    try {
      response = await agent.createResponse(conversation, availableTools);
    } catch (error: any) {
      // Handle provider-specific errors gracefully
      console.error(`\n❌ Error: ${error.message}\n`);

      // Suggest alternatives based on the provider
      if (agent.providerName === 'lmstudio') {
        console.error(
          `💡 Try using Anthropic Claude instead: node dist/agent.js --provider anthropic\n`
        );
      }

      return 'I encountered an error processing your request. Please see the error message above.';
    }

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

        process.stdout.write(
          `\n🔧 Running: ${toolCall.name} with ${JSON.stringify(toolCall.input)}\n`
        );

        // Execute tool
        const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);

        // Add tool result to thread
        threadManager.addEvent(threadId, 'TOOL_RESULT', {
          callId: toolCall.id,
          output: result.output,
          success: result.success,
          error: result.error,
        });

        process.stdout.write(result.output + '\n');
      }

      // Recurse to get next response
      return processMessage('');
    }

    return response.content;
  }

  console.log(
    `🤖 Lace Agent started using ${provider.providerName} provider. Type "exit" to quit.\n`
  );

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
}

// Start the application
main().catch(console.error);
