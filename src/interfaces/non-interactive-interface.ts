// ABOUTME: Non-interactive interface for single prompt execution
// ABOUTME: Handles --prompt flag execution without user interaction

import type { Agent } from '../agents/agent.js';

/**
 * Non-interactive interface for single prompt execution
 * Used when --prompt flag is provided
 */
export class NonInteractiveInterface {
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
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
    await this.agent.stop();
  }
}
