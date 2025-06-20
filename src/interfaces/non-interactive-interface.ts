// ABOUTME: Non-interactive interface for single prompt execution
// ABOUTME: Handles --prompt flag execution without user interaction

import type { Agent } from '../agents/agent.js';
import type { UserInterface } from '../commands/types.js';

/**
 * Non-interactive interface for single prompt execution
 * Used when --prompt flag is provided
 */
export class NonInteractiveInterface implements UserInterface {
  agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  displayMessage(message: string): void {
    console.log(message);
  }

  clearSession(): void {
    // Create new thread and agent
    const newThreadId = this.agent.threadManager.generateThreadId();
    this.agent.threadManager.createThread(newThreadId);
  }

  exit(): void {
    process.exit(0);
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
