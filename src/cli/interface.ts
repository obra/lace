// ABOUTME: CLI interface class for interactive readline-based chat with Agent
// ABOUTME: Handles user input/output, displays Agent events, and manages readline lifecycle

import * as readline from 'readline';
import { Agent } from '../agents/agent.js';
import { handleGracefulShutdown } from '../threads/session.js';
import { ThreadManager } from '../threads/thread-manager.js';

export class CLIInterface {
  private agent: Agent;
  private threadManager: ThreadManager;
  private rl: readline.Interface | null = null;
  private isRunning = false;

  constructor(agent: Agent, threadManager: ThreadManager) {
    this.agent = agent;
    this.threadManager = threadManager;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle streaming tokens (real-time display)
    this.agent.on('agent_token', ({ token }) => {
      // Write tokens directly to stdout for real-time streaming
      process.stdout.write(token);
    });

    // Handle agent responses
    this.agent.on('agent_thinking_complete', ({ content }) => {
      // Extract think blocks and show them in italics
      const thinkMatches = content.match(/<think>[\s\S]*?<\/think>/g);

      if (thinkMatches) {
        thinkMatches.forEach((thinkBlock) => {
          const thinkContent = thinkBlock.replace(/<\/?think>/g, '').trim();
          if (thinkContent) {
            process.stdout.write(`\n\x1b[3m${thinkContent}\x1b[0m\n\n`);
          }
        });
      }
    });

    this.agent.on('agent_response_complete', ({ content }) => {
      // For streaming, tokens are already displayed, just add final newlines
      // For non-streaming, show the complete response
      if (this.agent.getCurrentState() === 'streaming') {
        // Just add spacing after streaming response
        process.stdout.write(`\n\n`);
      } else {
        // Show full content for non-streaming
        if (content && content.length > 0) {
          process.stdout.write(`${content}\n\n`);
        }
      }
    });

    // Handle tool execution
    this.agent.on('tool_call_start', ({ toolName, input }) => {
      // Show tool call with truncated input for readability
      const inputDisplay =
        JSON.stringify(input).length > 100
          ? JSON.stringify(input).substring(0, 100) + '...'
          : JSON.stringify(input);

      process.stdout.write(`\n🔧 Running: ${toolName} with ${inputDisplay}\n`);
    });

    this.agent.on('tool_call_complete', ({ result }) => {
      const outputText = result.content[0]?.text || '';

      // Show tool result status
      if (result.success) {
        const outputLength = outputText.length;
        if (outputLength > 500) {
          // Show truncated output for large results
          const truncated = outputText.substring(0, 500);
          process.stdout.write(`✅ Tool completed (${outputLength} chars):\n${truncated}...\n\n`);
        } else {
          // Show full output for small results
          process.stdout.write(`✅ Tool completed:\n${outputText}\n\n`);
        }
      } else {
        process.stdout.write(`❌ Tool failed: ${result.error || 'Unknown error'}\n\n`);
      }
    });

    // Handle errors
    this.agent.on('error', ({ error }) => {
      console.error(`\n❌ Error: ${error.message}\n`);

      // Suggest alternatives based on the provider
      if (this.agent.providerName === 'lmstudio') {
        console.error(
          `💡 Try using Anthropic Claude instead: node dist/cli.js --provider anthropic\n`
        );
      }
    });
  }

  async handleSinglePrompt(prompt: string): Promise<void> {
    console.log(`🤖 Lace Agent using ${this.agent.providerName} provider.\n`);

    // Start agent and process the prompt
    this.agent.start();
    await this.agent.sendMessage(prompt);

    // Save and exit
    await handleGracefulShutdown(this.threadManager);
  }

  async startInteractive(): Promise<void> {
    if (this.isRunning) {
      throw new Error('CLI interface is already running');
    }

    this.isRunning = true;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log(
      `🤖 Lace Agent started using ${this.agent.providerName} provider. Type "/exit" to quit.\n`
    );

    // Start the agent
    this.agent.start();

    // Handle graceful shutdown on Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down gracefully...');
      await this.stop();
      process.exit(0);
    });

    // Interactive loop
    while (this.isRunning) {
      const input = await new Promise<string>((resolve) => this.rl!.question('> ', resolve));

      if (input.toLowerCase() === '/exit' || input.toLowerCase() === 'exit') {
        await this.stop();
        break;
      }

      // Handle slash commands
      if (input.startsWith('/')) {
        await this.handleSlashCommand(input);
        continue;
      }

      if (input.trim()) {
        await this.agent.sendMessage(input);
      }
    }
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const command = input.toLowerCase().trim();

    switch (command) {
      case '/compact': {
        const threadId = this.threadManager.getCurrentThreadId();
        if (!threadId) {
          console.log('❌ No active thread to compact');
          return;
        }

        this.threadManager.compact(threadId);

        // Get the system message that was added
        const events = this.threadManager.getEvents(threadId);
        const systemMessage = events.find(
          (e) =>
            e.type === 'LOCAL_SYSTEM_MESSAGE' &&
            typeof e.data === 'string' &&
            e.data.includes('Compacted')
        );

        if (systemMessage) {
          console.log(systemMessage.data);
        } else {
          console.log('✅ Thread compaction completed');
        }
        break;
      }

      case '/help': {
        console.log('Available commands:');
        console.log('  /compact  - Compress tool results to save tokens');
        console.log('  /help     - Show this help message');
        console.log('  /exit     - Exit the application (or just "exit")');
        break;
      }

      default: {
        console.log(`❌ Unknown command: ${command}`);
        console.log('Type /help for available commands');
        break;
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.agent) {
      this.agent.stop();
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    await handleGracefulShutdown(this.threadManager);
  }
}
