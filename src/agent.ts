#!/usr/bin/env node
// ABOUTME: Interactive CLI interface for the Lace AI coding assistant
// ABOUTME: Handles user input/output and orchestrates agent, tools, and thread management

import * as readline from 'readline';
import { Agent } from './agents/agent.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { LMStudioProvider } from './providers/lmstudio-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { AIProvider } from './providers/types.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { BashTool } from './tools/implementations/bash.js';
import { buildConversationFromEvents } from './threads/conversation-builder.js';
import { startSession, handleGracefulShutdown } from './threads/session.js';
import { logger } from './utils/logger.js';
import { loadPromptConfig, getPromptFilePaths } from './config/prompts.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    provider: 'anthropic' as 'anthropic' | 'lmstudio' | 'ollama',
    help: false,
    logLevel: 'info' as 'error' | 'warn' | 'info' | 'debug',
    logFile: undefined as string | undefined,
    prompt: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--provider' || arg === '-p') {
      const providerValue = args[i + 1];
      if (!providerValue || !['anthropic', 'lmstudio', 'ollama'].includes(providerValue)) {
        console.error('Error: --provider must be "anthropic", "lmstudio", or "ollama"');
        process.exit(1);
      }
      options.provider = providerValue as 'anthropic' | 'lmstudio' | 'ollama';
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--provider=')) {
      const providerValue = arg.split('=')[1];
      if (!['anthropic', 'lmstudio', 'ollama'].includes(providerValue)) {
        console.error('Error: --provider must be "anthropic", "lmstudio", or "ollama"');
        process.exit(1);
      }
      options.provider = providerValue as 'anthropic' | 'lmstudio' | 'ollama';
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
    } else if (arg === '--prompt') {
      const promptValue = args[i + 1];
      if (!promptValue) {
        console.error('Error: --prompt requires a prompt text');
        process.exit(1);
      }
      options.prompt = promptValue;
      i++; // Skip next argument since we consumed it
    } else if (arg.startsWith('--prompt=')) {
      const promptValue = arg.split('=')[1];
      if (!promptValue) {
        console.error('Error: --prompt requires a prompt text');
        process.exit(1);
      }
      options.prompt = promptValue;
    } else if (arg === '--continue') {
      // --continue is handled by startSession(), just allow it to pass through
    } else if (arg.startsWith('lace_')) {
      // Thread ID arguments are handled by startSession(), just allow them to pass through
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
  -p, --provider <name>     Choose AI provider: "anthropic" (default), "lmstudio", or "ollama"
  --log-level <level>       Set log level: "error", "warn", "info" (default), or "debug"
  --log-file <path>         Write logs to file (no file = no logging)
  --prompt <text>           Send a single prompt and exit (non-interactive mode)
  --continue [session_id]   Continue previous conversation (latest if no ID provided)

Examples:
  lace                      # Use Anthropic Claude (default)
  lace --provider anthropic # Use Anthropic Claude explicitly
  lace --provider lmstudio  # Use local LMStudio server
  lace --provider ollama    # Use local Ollama server
  lace --log-level debug --log-file debug.log  # Debug logging to file
  lace --prompt "What files are in the current directory?"  # Single command
  lace --continue           # Continue latest conversation
  lace --continue lace_20250615_abc123  # Continue specific conversation
  lace --continue --prompt "What number was that again?"  # Continue with new prompt

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
async function createProvider(
  providerType: 'anthropic' | 'lmstudio' | 'ollama'
): Promise<AIProvider> {
  // Load configurable prompts from user's Lace directory
  const promptConfig = loadPromptConfig();
  const { systemPrompt, filesCreated } = promptConfig;

  // Show helpful message if configuration files were created for the first time
  if (filesCreated.length > 0) {
    console.log('\n📝 Created default Lace configuration files:');
    filesCreated.forEach((filePath) => {
      console.log(`   ${filePath}`);
    });
    console.log("\n💡 Edit these files to customize your AI assistant's behavior.\n");
  }

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
    case 'ollama': {
      return new OllamaProvider({ systemPrompt });
    }
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }
}

async function main() {
  // Initialize logging
  logger.configure(options.logLevel, options.logFile);
  logger.info('Starting Lace Agent', { provider: options.provider, logLevel: options.logLevel });

  // Show configuration file locations on first startup
  const { systemPromptPath, userInstructionsPath } = getPromptFilePaths();
  logger.info('Lace configuration files', {
    systemPromptPath,
    userInstructionsPath,
    laceDir: process.env.LACE_DIR || '~/.lace',
  });

  const provider = await createProvider(options.provider);
  const agent = new Agent({ provider });

  const toolRegistry = new ToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);

  // Register tools
  toolRegistry.registerTool(new BashTool());

  // Start or resume session using enhanced thread management
  const { threadManager, threadId } = await startSession(process.argv.slice(2));

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

  // Handle single prompt mode (non-interactive)
  if (options.prompt) {
    console.log(`🤖 Lace Agent using ${provider.providerName} provider.\n`);

    // Process the single prompt
    await processMessage(options.prompt);

    // Save and exit
    await handleGracefulShutdown(threadManager);
    process.exit(0);
  }

  console.log(
    `🤖 Lace Agent started using ${provider.providerName} provider. Type "exit" to quit.\n`
  );

  // Handle graceful shutdown on Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');
    await handleGracefulShutdown(threadManager);
    process.exit(0);
  });

  while (true) {
    const input = await new Promise<string>((resolve) => rl.question('> ', resolve));
    if (input.toLowerCase() === 'exit') {
      await handleGracefulShutdown(threadManager);
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
