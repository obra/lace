// ABOUTME: Shared agent service for web API routes using core app.ts infrastructure
// ABOUTME: Provides API access to the shared Agent instance from WebInterface

import type { Agent } from '~/agents/agent';
import type { ToolExecutor } from '~/tools/executor';
import type { ThreadManager } from '~/threads/thread-manager';

export interface ThreadInfo {
  threadId: string;
  isNew: boolean;
}

/**
 * Shared agent service that provides API access to the Agent instance
 * created by the main application. This eliminates duplication with app.ts
 * and ensures all web interface components use the same Agent.
 */
class SharedAgentService {
  private static instance: SharedAgentService;
  private sharedAgent: Agent | null = null;

  private constructor() {}

  public static getInstance(): SharedAgentService {
    if (!SharedAgentService.instance) {
      SharedAgentService.instance = new SharedAgentService();
    }
    return SharedAgentService.instance;
  }

  /**
   * Set the shared Agent instance (called by WebInterface during initialization)
   */
  public setSharedAgent(agent: Agent): void {
    this.sharedAgent = agent;
  }

  /**
   * Get the shared Agent instance
   */
  public getSharedAgent(): Agent {
    if (!this.sharedAgent) {
      throw new Error('Shared agent not initialized. WebInterface must call setSharedAgent() first.');
    }
    return this.sharedAgent;
  }

  /**
   * Create a new Agent for a specific thread (delegates to shared agent's thread management)
   */
  public async createAgentForThread(threadId?: string): Promise<{ agent: Agent; threadInfo: ThreadInfo }> {
    const sharedAgent = this.getSharedAgent();
    
    // Handle thread creation/resumption through the shared Agent
    let sessionInfo;
    if (threadId) {
      sessionInfo = sharedAgent.resumeOrCreateThread(threadId);
    } else {
      sessionInfo = sharedAgent.resumeOrCreateThread();
    }

    const threadInfo: ThreadInfo = {
      threadId: sessionInfo.threadId,
      isNew: !sessionInfo.isResumed,
    };

    // Return the same agent instance but with the new thread context
    // Note: In a more sophisticated implementation, we might create a new Agent
    // instance for the specific thread, but for now we reuse the shared one
    return { agent: sharedAgent, threadInfo };
  }

  /**
   * Get thread history through shared Agent's proper API
   */
  public async getThreadHistory(threadId: string): Promise<unknown[]> {
    const agent = this.getSharedAgent();
    
    // Use Agent's proper API instead of accessing ThreadManager directly
    const events = agent.getThreadEvents(threadId);

    if (!events || events.length === 0) {
      throw new Error('Thread not found');
    }

    // Transform events into API-friendly format
    return events
      .filter((event: any) => event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE')
      .map((event: any) => ({
        id: event.id,
        type: event.type.toLowerCase().replace('_', ''),
        content: typeof event.data === 'string' ? event.data : '',
        timestamp: event.timestamp.toISOString(),
      }));
  }

  /**
   * Get available tools through shared Agent's ToolExecutor
   */
  public getAvailableTools() {
    const agent = this.getSharedAgent();
    const tools = agent.toolExecutor.getAllTools();

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.inputSchema,
      destructive: tool.annotations?.destructiveHint || false,
    }));
  }

  /**
   * Get tool executor from shared Agent
   */
  public getToolExecutor(): ToolExecutor {
    const agent = this.getSharedAgent();
    return agent.toolExecutor;
  }
}

// Export singleton instance  
export const sharedAgentService = SharedAgentService.getInstance();
