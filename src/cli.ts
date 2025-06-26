#!/usr/bin/env node
// ABOUTME: Main CLI entry point for Lace AI coding assistant
// ABOUTME: Orchestrates provider setup, Agent creation, and CLI interface management

import { loadEnvFile, getEnvVar } from './config/env-loader.js';

// Load environment variables from .env file before anything else
loadEnvFile();

import { Agent } from './agents/agent.js';
import { ProviderRegistry } from './providers/registry.js';
import { AIProvider } from './providers/base-provider.js';
import { ToolExecutor } from './tools/executor.js';
import { DelegateTool } from './tools/implementations/delegate.js';
import { ThreadManager } from './threads/thread-manager.js';
import { getLaceDbPath } from './config/lace-dir.js';
import { logger } from './utils/logger.js';
import { parseArgs, validateProvider } from './cli/args.js';
import { TerminalInterface } from './interfaces/terminal/terminal-interface.js';
import { NonInteractiveInterface } from './interfaces/non-interactive-interface.js';
import { createGlobalPolicyCallback } from './tools/policy-wrapper.js';

// Create provider based on CLI option
async function createProvider(
  registry: ProviderRegistry,
  providerType: string,
  model?: string
): Promise<AIProvider> {
  // Get base provider from registry
  const baseProvider = registry.getProvider(providerType);
  if (!baseProvider) {
    const availableProviders = registry.getProviderNames();
    console.error(
      `Error: Unknown provider '${providerType}'. Available providers: ${availableProviders.join(', ')}`
    );
    process.exit(1);
  }

  // Create properly configured provider based on type
  switch (providerType) {
    case 'anthropic': {
      const apiKey = getEnvVar('ANTHROPIC_KEY');
      if (!apiKey) {
        console.error('Error: ANTHROPIC_KEY environment variable required for Anthropic provider');
        process.exit(1);
      }
      const { AnthropicProvider } = await import('./providers/anthropic-provider.js');
      return new AnthropicProvider({ apiKey, model });
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
      if (!apiKey) {
        console.error(
          'Error: OPENAI_API_KEY or OPENAI_KEY environment variable required for OpenAI provider'
        );
        process.exit(1);
      }
      const { OpenAIProvider } = await import('./providers/openai-provider.js');
      return new OpenAIProvider({ apiKey, model });
    }
    case 'lmstudio': {
      const { LMStudioProvider } = await import('./providers/lmstudio-provider.js');
      return new LMStudioProvider({ model });
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./providers/ollama-provider.js');
      return new OllamaProvider({ model });
    }
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }
}

async function main() {
  // Parse arguments
  const options = await parseArgs();

  // Initialize logging
  logger.configure(options.logLevel, options.logFile);
  logger.info('Starting Lace Agent', {
    provider: options.provider,
    model: options.model || 'default',
    logLevel: options.logLevel,
  });

  // Show configuration file locations on first startup
  logger.info('Lace configuration files', {
    laceDir: getEnvVar('LACE_DIR', '~/.lace'),
    note: 'System prompts are generated from templates',
  });

  // Initialize provider registry
  const registry = await ProviderRegistry.createWithAutoDiscovery();

  // Validate provider against registry
  validateProvider(options.provider, registry);

  // Create and configure tool executor with all available tools
  const toolExecutor = new ToolExecutor();
  toolExecutor.registerAllAvailableTools();

  const provider = await createProvider(registry, options.provider, options.model);

  // Create thread manager and start/resume session
  const threadManager = new ThreadManager(getLaceDbPath());

  // Handle --continue logic from CLI options
  let continueThreadId: string | undefined;
  if (options.continue) {
    if (typeof options.continue === 'string') {
      continueThreadId = options.continue;
    } else {
      // --continue with no argument, get latest
      logger.debug('Attempting to get latest thread ID');
      continueThreadId = (await threadManager.getLatestThreadId()) || undefined;
      logger.debug(`Latest thread ID: ${continueThreadId}`);
    }
  }

  const sessionInfo = await threadManager.resumeOrCreate(continueThreadId);
  const { threadId } = sessionInfo;

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
    tools: toolExecutor.getAllTools(),
  });

  // Set up delegate tool dependencies
  const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
  if (delegateTool) {
    delegateTool.setDependencies(threadManager, toolExecutor);
  }

  // Create interface (always use terminal interface since CLIInterface is removed)
  const cli = new TerminalInterface(agent);

  // Set up tool approval system: CLI policies apply globally
  const policyCallback = createGlobalPolicyCallback(cli, options, agent.toolExecutor);
  agent.toolExecutor.setApprovalCallback(policyCallback);

  // Handle single prompt mode (non-interactive)
  if (options.prompt) {
    const nonInteractive = new NonInteractiveInterface(agent);
    await nonInteractive.executePrompt(options.prompt);
    process.exit(0);
  }

  // Start interactive mode
  await cli.startInteractive();
}

// Start the application
main().catch(console.error);
