// ABOUTME: Core application setup and orchestration for the Lace AI assistant
// ABOUTME: This module initializes all major components and starts the appropriate interface.

import { Agent } from './agents/agent.js';
import { AIProvider } from './providers/base-provider.js';
import { ToolExecutor } from './tools/executor.js';
import { DelegateTool } from './tools/implementations/delegate.js';
import { ThreadManager } from './threads/thread-manager.js';
import { getLaceDbPath } from './config/lace-dir.js';
import { logger } from './utils/logger.js';
import { CLIOptions } from './cli/args.js';
import { NonInteractiveInterface } from './interfaces/non-interactive-interface.js';
import { createGlobalPolicyCallback } from './tools/policy-wrapper.js';
import { enableTrafficLogging } from './utils/traffic-logger.js';
import { getEnvVar } from './config/env-loader.js';

// Provider creation mapping
const providerInitializers: Record<
  string,
  (config: { apiKey?: string; model?: string }) => Promise<AIProvider>
> = {
  anthropic: async ({ apiKey, model }) => {
    // Check for test mode to use mock provider
    if (getEnvVar('LACE_TEST_MODE') === 'true') {
      const { createMockProvider } = await import('./__tests__/utils/mock-provider.js');
      return createMockProvider();
    }

    const { AnthropicProvider } = await import('./providers/anthropic-provider.js');
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    return new AnthropicProvider({ apiKey, model });
  },
  openai: async ({ apiKey, model }) => {
    const { OpenAIProvider } = await import('./providers/openai-provider.js');
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    return new OpenAIProvider({ apiKey, model });
  },
  lmstudio: async ({ model }) => {
    const { LMStudioProvider } = await import('./providers/lmstudio-provider.js');
    return new LMStudioProvider({ model });
  },
  ollama: async ({ model }) => {
    const { OllamaProvider } = await import('./providers/ollama-provider.js');
    return new OllamaProvider({ model });
  },
};

async function createProvider(providerType: string, model?: string): Promise<AIProvider> {
  const initializer = providerInitializers[providerType];
  if (!initializer) {
    throw new Error(
      `Unknown provider: ${providerType}. Available providers are: ${Object.keys(providerInitializers).join(', ')}`
    );
  }

  let apiKey: string | undefined;
  if (providerType === 'anthropic') {
    apiKey = getEnvVar('ANTHROPIC_KEY');
    if (!apiKey) {
      console.error('Error: ANTHROPIC_KEY environment variable required for Anthropic provider');
      process.exit(1);
    }
  } else if (providerType === 'openai') {
    apiKey = getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_KEY');
    if (!apiKey) {
      console.error(
        'Error: OPENAI_API_KEY or OPENAI_KEY environment variable required for OpenAI provider'
      );
      process.exit(1);
    }
  }

  return initializer({ apiKey, model });
}

async function initializeServices(options: CLIOptions) {
  logger.configure(options.logLevel, options.logFile);
  if (options.harFile) {
    await enableTrafficLogging(options.harFile);
  }

  logger.info('Starting Lace Agent', {
    provider: options.provider,
    model: options.model || 'default',
    logLevel: options.logLevel,
    harRecording: !!options.harFile,
  });

  logger.info('Lace configuration files', {
    laceDir: getEnvVar('LACE_DIR', '~/.lace'),
    note: 'System prompts are generated from templates',
  });
}

async function setupAgent(
  options: CLIOptions,
  threadId: string,
  threadManager: ThreadManager
): Promise<Agent> {
  const toolExecutor = new ToolExecutor();
  toolExecutor.registerAllAvailableTools();

  const provider = await createProvider(options.provider, options.model);
  const agent = new Agent({
    provider,
    toolExecutor,
    threadManager,
    threadId,
    tools: toolExecutor.getAllTools(),
  });

  const delegateTool = toolExecutor.getTool('delegate') as DelegateTool;
  if (delegateTool) {
    delegateTool.setDependencies(agent, toolExecutor);
  }

  return agent;
}

async function handleSession(
  threadManager: ThreadManager,
  continueMode?: boolean | string
): Promise<string> {
  let continueThreadId: string | undefined;
  if (continueMode) {
    if (typeof continueMode === 'string') {
      continueThreadId = continueMode;
    } else {
      logger.debug('Attempting to get latest thread ID');
      continueThreadId = (await threadManager.getLatestThreadId()) || undefined;
      logger.debug(`Latest thread ID: ${continueThreadId}`);
    }
  }

  const sessionInfo = await threadManager.resumeOrCreate(continueThreadId);
  const { threadId } = sessionInfo;

  if (sessionInfo.isResumed) {
    console.log(`📖 Continuing conversation ${threadId}`);
  } else if (sessionInfo.resumeError) {
    console.warn(`⚠️  ${sessionInfo.resumeError}`);
    console.log(`🆕 Starting new conversation ${threadId}`);
  } else {
    console.log(`🆕 Starting conversation ${threadId}`);
  }

  return threadId;
}

async function handleSessionWithAgent(
  agent: Agent,
  continueMode?: boolean | string
): Promise<string> {
  let continueThreadId: string | undefined;
  if (continueMode) {
    if (typeof continueMode === 'string') {
      continueThreadId = continueMode;
    } else {
      // Get latest thread ID through Agent API
      continueThreadId = await agent.getLatestThreadId() || undefined;
    }
  }

  const sessionInfo = await agent.resumeOrCreateThread(continueThreadId);
  const { threadId } = sessionInfo;

  if (sessionInfo.isResumed) {
    console.log(`📖 Continuing conversation ${threadId}`);
  } else if (sessionInfo.resumeError) {
    console.warn(`⚠️  ${sessionInfo.resumeError}`);
    console.log(`🆕 Starting new conversation ${threadId}`);
  } else {
    console.log(`🆕 Starting conversation ${threadId}`);
  }

  return threadId;
}

export async function run(options: CLIOptions): Promise<void> {
  await initializeServices(options);

  const threadManager = new ThreadManager(getLaceDbPath());
  
  // Create a temporary agent to handle session resumption
  const tempThreadId = threadManager.generateThreadId();
  threadManager.createThread(tempThreadId);
  const agent = await setupAgent(options, tempThreadId, threadManager);
  
  // Use Agent to handle session resumption with automatic replay
  const sessionThreadId = await handleSessionWithAgent(agent, options.continue);

  if (options.prompt) {
    const nonInteractive = new NonInteractiveInterface(agent);
    await nonInteractive.executePrompt(options.prompt);
    process.exit(0);
  }

  const { TerminalInterface } = await import('./interfaces/terminal/terminal-interface.js');
  const cli = new TerminalInterface(agent);

  const policyCallback = createGlobalPolicyCallback(cli, options, agent.toolExecutor);
  agent.toolExecutor.setApprovalCallback(policyCallback);

  await cli.startInteractive();
}
