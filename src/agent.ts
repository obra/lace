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
import { logger } from './utils/logger.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    provider: 'anthropic' as 'anthropic' | 'lmstudio',
    help: false,
    logLevel: 'info' as 'error' | 'warn' | 'info' | 'debug',
    logFile: undefined as string | undefined,
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
    } else if (arg === '--log-level') {
      const levelValue = args[i + 1];
      if (!levelValue || !['error', 'warn', 'info', 'debug'].includes(levelValue)) {
        console.error('Error: --log-level must be "error", "warn", "info", or "debug"');
        process.exit(1);
      }
      options.logLevel = levelValue as 'error' | 'warn' | 'info' | 'debug';
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--log-level=')) {
      const levelValue = arg.split('=')[1];
      if (!['error', 'warn', 'info', 'debug'].includes(levelValue)) {
        console.error('Error: --log-level must be "error", "warn", "info", or "debug"');
        process.exit(1);
      }
      options.logLevel = levelValue as 'error' | 'warn' | 'info' | 'debug';
    } else if (arg === '--log-file') {
      const fileValue = args[i + 1];
      if (!fileValue) {
        console.error('Error: --log-file requires a file path');
        process.exit(1);
      }
      options.logFile = fileValue;
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--log-file=')) {
      const fileValue = arg.split('=')[1];
      if (!fileValue) {
        console.error('Error: --log-file requires a file path');
        process.exit(1);
      }
      options.logFile = fileValue;
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
  --log-level <level>       Set log level: "error", "warn", "info" (default), or "debug"
  --log-file <path>         Write logs to file (no file = no logging)

Examples:
  lace                      # Use Anthropic Claude (default)
  lace --provider anthropic # Use Anthropic Claude explicitly
  lace --provider lmstudio  # Use local LMStudio server
  lace --log-level debug --log-file debug.log  # Debug logging to file

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
  // Initialize logging
  logger.configure(options.logLevel, options.logFile);
  logger.info('Starting Lace Agent', { provider: options.provider, logLevel: options.logLevel });

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

    logger.debug('AGENT: Requesting response from provider', {
      conversationLength: conversation.length,
      availableToolCount: availableTools.length,
      availableToolNames: availableTools.map((t) => t.name),
      conversationMessages: conversation.map((msg) => ({
        role: msg.role,
        contentLength: msg.content.length,
        contentPreview: msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : ''),
      })),
    });

    let response;

    try {
      response = await agent.createResponse(conversation, availableTools);

      logger.debug('AGENT: Received response from provider', {
        hasContent: !!response.content,
        contentLength: response.content?.length || 0,
        toolCallCount: response.toolCalls.length,
        toolCallDetails: response.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
        responseContent: response.content,
      });
    } catch (error: unknown) {
      logger.error('AGENT: Provider error', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        providerName: agent.providerName,
      });

      // Handle provider-specific errors gracefully
      console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);

      // Suggest alternatives based on the provider
      if (agent.providerName === 'lmstudio') {
        console.error(
          `💡 Try using Anthropic Claude instead: node dist/agent.js --provider anthropic\n`
        );
      }

      return 'I encountered an error processing your request. Please see the error message above.';
    }

    // Clean up and add agent message to thread
    if (response.content) {
      // Extract think blocks and regular content
      const thinkMatches = response.content.match(/<think>([\s\S]*?)<\/think>/g);
      const cleanedContent = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      threadManager.addEvent(threadId, 'AGENT_MESSAGE', response.content);
      logger.debug('AGENT: Added agent message to thread', {
        contentLength: response.content.length,
        cleanedLength: cleanedContent.length,
        thinkBlockCount: thinkMatches?.length || 0,
      });

      // Show think blocks in italics if present
      if (thinkMatches) {
        thinkMatches.forEach((thinkBlock) => {
          const thinkContent = thinkBlock.replace(/<\/?think>/g, '').trim();
          if (thinkContent) {
            process.stdout.write(`\n\x1b[3m${thinkContent}\x1b[0m\n\n`);
          }
        });
      }

      // Show cleaned response to user if there's meaningful content
      if (cleanedContent && cleanedContent.length > 0) {
        process.stdout.write(`${cleanedContent}\n\n`);
      }
    }

    // Handle tool calls
    if (response.toolCalls.length > 0) {
      logger.debug('AGENT: Processing tool calls', {
        toolCallCount: response.toolCalls.length,
        toolCalls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        logger.debug('AGENT: Executing individual tool call', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: toolCall.input,
        });

        // Add tool call to thread
        threadManager.addEvent(threadId, 'TOOL_CALL', {
          toolName: toolCall.name,
          input: toolCall.input,
          callId: toolCall.id,
        });

        // Show tool call with truncated input for readability
        const inputDisplay =
          JSON.stringify(toolCall.input).length > 100
            ? JSON.stringify(toolCall.input).substring(0, 100) + '...'
            : JSON.stringify(toolCall.input);

        process.stdout.write(`\n🔧 Running: ${toolCall.name} with ${inputDisplay}\n`);

        // Execute tool
        const result = await toolExecutor.executeTool(toolCall.name, toolCall.input);

        logger.debug('AGENT: Tool execution completed', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: result.success,
          outputLength: result.output?.length || 0,
          hasError: !!result.error,
          toolResult: result,
        });

        // Show tool result status
        if (result.success) {
          const outputLength = result.output?.length || 0;
          if (outputLength > 500) {
            // Show truncated output for large results
            const truncated = result.output.substring(0, 500);
            process.stdout.write(`✅ Tool completed (${outputLength} chars):\n${truncated}...\n\n`);
          } else {
            // Show full output for small results
            process.stdout.write(`✅ Tool completed:\n${result.output}\n\n`);
          }
        } else {
          process.stdout.write(`❌ Tool failed: ${result.error || 'Unknown error'}\n\n`);
        }

        // Add tool result to thread
        threadManager.addEvent(threadId, 'TOOL_RESULT', {
          callId: toolCall.id,
          output: result.output,
          success: result.success,
          error: result.error,
        });
      }

      // Recurse to get next response
      return processMessage('');
    }

    // Return empty string since we already displayed the content above
    return '';
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
