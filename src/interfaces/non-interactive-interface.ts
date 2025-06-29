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
      // Wait for conversation_complete (when no tools are called) OR agent_response_complete (when response is done)
      this.agent.once('conversation_complete', () => {
        resolve();
      });

      this.agent.once('agent_response_complete', ({ content }: { content: string }) => {
        console.log('\n');
        // In non-interactive mode, we consider the conversation complete when the agent
        // finishes its response, even if tool calls are pending. This prevents hangs.
        resolve();
      });

      this.agent.once('error', ({ error }: { error: Error }) => {
        reject(error);
      });

      // Stream response tokens to stdout for real-time display
      this.agent.on('agent_token', ({ token }: { token: string }) => {
        process.stdout.write(token);
      });
    });

    // Create timeout promise to prevent indefinite hanging
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error('NonInteractiveInterface timeout: conversation did not complete within 15 seconds'));
      }, 15000); // 15 second timeout
    });

    // Send message and wait for conversation to complete or timeout
    // If sendMessage throws, don't wait for conversationComplete (fixes race condition)
    try {
      await this.agent.sendMessage(prompt);
      await Promise.race([conversationComplete, timeout]);
    } finally {
      // Always clean up agent resources, even on error
      try {
        await this.agent.stop();
      } catch (stopError) {
        // Log but don't throw stop errors - the original error is more important
        console.error('Failed to stop agent:', stopError);
      }
    }
  }
}
