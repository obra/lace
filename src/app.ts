// ABOUTME: Core application setup and orchestration for the Lace AI assistant
// ABOUTME: This module initializes all major components and starts the appropriate interface.

import { Agent } from '~/agents/agent';
import { AIProvider } from '~/providers/base-provider';
import { ToolExecutor } from '~/tools/executor';
import { DelegateTool } from '~/tools/implementations/delegate';
import { ThreadManager } from '~/threads/thread-manager';
import { logger } from '~/utils/logger';
import { CLIOptions } from '~/cli/args';
import { NonInteractiveInterface } from '~/interfaces/non-interactive-interface';
import { enableTrafficLogging } from '~/utils/traffic-logger';
import { getEnvVar } from '~/config/env-loader';
import { ProviderRegistry } from '~/providers/registry';

export function createProvider(providerType: string, model?: string): AIProvider {
  try {
    const registry = ProviderRegistry.createWithAutoDiscovery();
    return registry.createProvider(providerType, { model });
  } catch (error) {
    if (error instanceof Error && error.message.includes('environment variable required')) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
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

function setupAgent(options: CLIOptions, threadId: string, threadManager: ThreadManager): Agent {
  const toolExecutor = new ToolExecutor();
  toolExecutor.registerAllAvailableTools();

  const provider = createProvider(options.provider, options.model);
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

function handleSessionWithAgent(agent: Agent, continueMode?: boolean | string): string {
  let continueThreadId: string | undefined;
  if (continueMode) {
    if (typeof continueMode === 'string') {
      continueThreadId = continueMode;
    } else {
      // Get latest thread ID through Agent API
      continueThreadId = agent.getLatestThreadId() || undefined;
    }
  }

  const sessionInfo = agent.resumeOrCreateThread(continueThreadId);
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

  const threadManager = new ThreadManager();

  // Create a temporary agent to handle session resumption
  const tempThreadId = threadManager.generateThreadId();
  threadManager.createThread(tempThreadId);
  const agent = setupAgent(options, tempThreadId, threadManager);

  // Use Agent to handle session resumption with automatic replay
  handleSessionWithAgent(agent, options.continue);

  // Default to non-interactive mode with ephemeral session in ephemeral project
  const nonInteractive = new NonInteractiveInterface(agent);

  if (options.prompt) {
    await nonInteractive.executePrompt(options.prompt);
    process.exit(0);
  }

  // For now, if no prompt provided, show help or enter simple prompt mode
  console.log('Lace AI Assistant - Non-interactive mode');
  console.log('Use --prompt "your message" to send a message to the agent');
  console.log('Example: lace --prompt "List files in current directory"');
  process.exit(0);
}
