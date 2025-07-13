// ABOUTME: Centralized agent service for web API routes that encapsulates proper Agent setup
// ABOUTME: Ensures all web API access to core Lace functionality goes through the Agent interface

import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { DelegateTool } from '~/tools/implementations/delegate';
import { getLaceDbPath } from '~/config/lace-dir';
import { loadEnvFile, getEnvVar } from '~/config/env-loader';
import { AIProvider } from '~/providers/base-provider';
import { logger } from '~/utils/logger';

// Initialize environment once
loadEnvFile();

export interface AgentConfig {
  provider?: string;
  model?: string;
  threadId?: string;
}

export interface ThreadInfo {
  threadId: string;
  isNew: boolean;
}

class AgentService {
  private static instance: AgentService;
  private toolExecutor: ToolExecutor;
  private threadManager: ThreadManager;

  private constructor() {
    // Initialize core components once
    this.toolExecutor = new ToolExecutor();
    this.toolExecutor.registerAllAvailableTools();

    const dbPath = getLaceDbPath();
    this.threadManager = new ThreadManager(dbPath);

    logger.configure('info');
  }

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  private async createProvider(
    providerType: string = 'anthropic',
    model?: string
  ): Promise<AIProvider> {
    const providerInitializers: Record<
      string,
      (config: { apiKey?: string; model?: string }) => Promise<AIProvider>
    > = {
      anthropic: async ({ apiKey, model }) => {
        if (getEnvVar('LACE_TEST_MODE') === 'true') {
          const { createMockProvider } = await import('~/__tests__/utils/mock-provider');
          return createMockProvider();
        }

        const { AnthropicProvider } = await import('~/providers/anthropic-provider');
        if (!apiKey) {
          throw new Error('Anthropic API key is required');
        }
        return new AnthropicProvider({ apiKey, model });
      },
      openai: async ({ apiKey, model }) => {
        const { OpenAIProvider } = await import('~/providers/openai-provider');
        if (!apiKey) {
          throw new Error('OpenAI API key is required');
        }
        return new OpenAIProvider({ apiKey, model });
      },
    };

    const initializer = providerInitializers[providerType];
    if (!initializer) {
      throw new Error(
        `Unknown provider: ${providerType}. Available: ${Object.keys(providerInitializers).join(', ')}`
      );
    }

    let apiKey: string | undefined;
    if (providerType === 'anthropic') {
      apiKey = getEnvVar('ANTHROPIC_KEY');
      if (!apiKey) {
        throw new Error('ANTHROPIC_KEY environment variable required');
      }
    } else if (providerType === 'openai') {
      apiKey = getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_KEY');
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY or OPENAI_KEY environment variable required');
      }
    }

    return initializer({ apiKey, model });
  }

  /**
   * Create an Agent instance with proper thread management
   * All thread operations go through the Agent - no direct ThreadManager access
   */
  public async createAgent(
    config: AgentConfig = {}
  ): Promise<{ agent: Agent; threadInfo: ThreadInfo }> {
    const provider = config.provider || 'anthropic';
    const model = config.model;

    // Handle thread creation/resumption through the Agent pattern
    // The Agent will manage ThreadManager access internally
    let threadInfo: ThreadInfo;

    if (config.threadId) {
      // Let the Agent handle thread resumption
      const sessionInfo = this.threadManager.resumeOrCreate(config.threadId);
      threadInfo = {
        threadId: sessionInfo.threadId,
        isNew: !sessionInfo.isResumed,
      };
    } else {
      // Create new thread
      const sessionInfo = this.threadManager.resumeOrCreate();
      threadInfo = {
        threadId: sessionInfo.threadId,
        isNew: true,
      };
    }

    // Create provider
    const aiProvider = await this.createProvider(provider, model);

    // Create agent with all dependencies
    const agent = new Agent({
      provider: aiProvider,
      toolExecutor: this.toolExecutor,
      threadManager: this.threadManager,
      threadId: threadInfo.threadId,
      tools: this.toolExecutor.getAllTools(),
    });

    // Setup delegate tool dependencies
    const delegateTool = this.toolExecutor.getTool('delegate') as DelegateTool;
    if (delegateTool) {
      delegateTool.setDependencies(agent, this.toolExecutor);
    }

    return { agent, threadInfo };
  }

  /**
   * Get thread history through Agent interface
   * This ensures we follow the architecture pattern
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- This method is async for consistency with Agent interface but doesn't use await internally
  public async getThreadHistory(threadId: string): Promise<unknown[]> {
    // For now, we'll access ThreadManager directly for read operations
    // In a full implementation, this would go through Agent
    const events = this.threadManager.getEvents(threadId);

    if (!events || events.length === 0) {
      throw new Error('Thread not found');
    }

    // Transform events into API-friendly format
    return events
      .filter((event) => event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE')
      .map((event) => ({
        id: event.id,
        type: event.type.toLowerCase().replace('_', ''),
        content: typeof event.data === 'string' ? event.data : '',
        timestamp: event.timestamp.toISOString(),
      }));
  }

  /**
   * Get available tools through ToolExecutor interface
   */
  public getAvailableTools() {
    const tools = this.toolExecutor.getAllTools();

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.inputSchema,
      destructive: tool.annotations?.destructiveHint || false,
    }));
  }

  /**
   * Get tool executor for direct tool execution
   * This allows API routes to execute tools while maintaining proper encapsulation
   */
  public getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }
}

// Export singleton instance
export const agentService = AgentService.getInstance();
