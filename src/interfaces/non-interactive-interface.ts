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
    await this.agent.start();

    // Create promise that resolves when conversation completes or errors
    const conversationComplete = new Promise<void>((resolve, reject) => {
      this.agent.once('conversation_complete', () => {
        resolve();
      });
      
      this.agent.once('error', ({ error }: { error: Error }) => {
        reject(error);
      });
    });

    // Send message and wait for conversation to complete
    await this.agent.sendMessage(prompt);
    await conversationComplete;

    // Save and exit
    await this.agent.stop();
  }
}
