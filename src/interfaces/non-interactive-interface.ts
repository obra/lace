// ABOUTME: Non-interactive interface for single prompt execution
// ABOUTME: Handles --prompt flag execution without user interaction

import type { Agent } from '../agents/agent.js';
import type { ThreadManager } from '../threads/thread-manager.js';
import type { ToolExecutor } from '../tools/executor.js';

/**
 * Non-interactive interface for single prompt execution
 * Used when --prompt flag is provided
 */
export class NonInteractiveInterface {
  private agent: Agent;
  private threadManager: ThreadManager;
  private toolExecutor?: ToolExecutor;

  constructor(agent: Agent, threadManager: ThreadManager, toolExecutor?: ToolExecutor) {
    this.agent = agent;
    this.threadManager = threadManager;
    this.toolExecutor = toolExecutor;
  }

  /**
   * Execute a single prompt and exit
   */
  async executePrompt(prompt: string): Promise<void> {
    console.log(`🤖 Lace Agent using ${this.agent.providerName} provider.\n`);

    // Start agent and process the prompt
    this.agent.start();
    await this.agent.sendMessage(prompt);

    // Save and exit
    await this.threadManager.close();
  }
}
