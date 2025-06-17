#!/usr/bin/env node
// ABOUTME: Main CLI entry point for Lace AI coding assistant
// ABOUTME: Orchestrates provider setup, Agent creation, and CLI interface management

import { Agent } from './agents/agent.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { LMStudioProvider } from './providers/lmstudio-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { AIProvider } from './providers/types.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { BashTool } from './tools/implementations/bash.js';
import { FileReadTool } from './tools/implementations/file-read.js';
import { FileWriteTool } from './tools/implementations/file-write.js';
import { FileEditTool } from './tools/implementations/file-edit.js';
import { FileInsertTool } from './tools/implementations/file-insert.js';
import { FileListTool } from './tools/implementations/file-list.js';
import { RipgrepSearchTool } from './tools/implementations/ripgrep-search.js';
import { FileFindTool } from './tools/implementations/file-find.js';
import {
  TaskAddTool,
  TaskListTool,
  TaskCompleteTool,
} from './tools/implementations/task-manager.js';
import { DelegateTool } from './tools/implementations/delegate.js';
import { startSession } from './threads/session.js';
import { logger } from './utils/logger.js';
import { loadPromptConfig, getPromptFilePaths } from './config/prompts.js';
import { parseArgs, showHelp } from './cli/args.js';
import { CLIInterface } from './cli/interface.js';

// Create provider based on CLI option
async function createProvider(
  providerType: 'anthropic' | 'lmstudio' | 'ollama',
  model?: string
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
      return new AnthropicProvider({ apiKey, systemPrompt, model });
    }
    case 'lmstudio': {
      return new LMStudioProvider({ systemPrompt, model });
    }
    case 'ollama': {
      return new OllamaProvider({ systemPrompt, model });
    }
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }
}

async function main() {
  // Parse arguments
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Initialize logging
  logger.configure(options.logLevel, options.logFile);
  logger.info('Starting Lace Agent', {
    provider: options.provider,
    model: options.model || 'default',
    logLevel: options.logLevel,
  });

  // Show configuration file locations on first startup
  const { systemPromptPath, userInstructionsPath } = getPromptFilePaths();
  logger.info('Lace configuration files', {
    systemPromptPath,
    userInstructionsPath,
    laceDir: process.env.LACE_DIR || '~/.lace',
  });

  const provider = await createProvider(options.provider, options.model);

  const toolRegistry = new ToolRegistry();
  const toolExecutor = new ToolExecutor(toolRegistry);

  // Register tools
  const delegateTool = new DelegateTool();

  const tools = [
    new BashTool(),
    new FileReadTool(),
    new FileWriteTool(),
    new FileEditTool(),
    new FileInsertTool(),
    new FileListTool(),
    new RipgrepSearchTool(),
    new FileFindTool(),
    new TaskAddTool(),
    new TaskListTool(),
    new TaskCompleteTool(),
    delegateTool,
  ];

  tools.forEach((tool) => toolRegistry.registerTool(tool));

  // Start or resume session using enhanced thread management
  const sessionInfo = await startSession(process.argv.slice(2));
  const { threadManager, threadId } = sessionInfo;

  // Inject dependencies into delegate tool (after we have threadManager)
  delegateTool.setDependencies(threadManager, toolRegistry);

  // Display session status to user
  if (sessionInfo.isResumed) {
    console.log(`📖 Continuing conversation ${threadId}`);
  } else if (sessionInfo.resumeError) {
    console.warn(`⚠️  ${sessionInfo.resumeError}`);
    console.log(`🆕 Starting new conversation ${threadId}`);
  } else {
    console.log(`🆕 Starting conversation ${threadId}`);
  }

  // Create the enhanced Agent
  const agent = new Agent({
    provider,
    toolExecutor,
    threadManager,
    threadId,
    tools,
  });

  // Create CLI interface
  const cli = new CLIInterface(agent, threadManager);

  // Handle single prompt mode (non-interactive)
  if (options.prompt) {
    await cli.handleSinglePrompt(options.prompt);
    process.exit(0);
  }

  // Start interactive mode
  await cli.startInteractive();
}

// Start the application
main().catch(console.error);
