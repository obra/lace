// ABOUTME: CLI interface class for interactive readline-based chat with Agent
// ABOUTME: Handles user input/output, displays Agent events, and manages readline lifecycle

import * as readline from 'readline';
import { Agent } from '../agents/agent.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ApprovalCallback, ApprovalDecision } from '../tools/approval-types.js';
import { ToolExecutor } from '../tools/executor.js';

export class CLIInterface implements ApprovalCallback {
  private agent: Agent;
  private threadManager: ThreadManager;
  private toolExecutor?: ToolExecutor;
  private rl: readline.Interface | null = null;
  private isRunning = false;

  constructor(agent: Agent, threadManager: ThreadManager, toolExecutor?: ToolExecutor) {
    this.agent = agent;
    this.threadManager = threadManager;
    this.toolExecutor = toolExecutor;
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
      if (!result.isError) {
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
        const errorText = result.content[0]?.text || 'Unknown error';
        process.stdout.write(`❌ Tool failed: ${errorText}\n\n`);
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

    await this.threadManager.close();
  }

  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // Create a temporary readline interface for approval prompts
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // Display tool information header
      process.stdout.write('\n🛡️  Tool approval request\n');
      process.stdout.write('═'.repeat(40) + '\n');

      // Show tool name and safety indicator
      const tool = this.toolExecutor?.getTool(toolName);
      const isReadOnly = tool?.annotations?.readOnlyHint === true;
      const safetyIndicator = isReadOnly ? '✅ read-only' : '⚠️  destructive';

      process.stdout.write(`Tool: ${toolName} (${safetyIndicator})\n`);

      // Format and display input parameters
      if (input && typeof input === 'object' && input !== null) {
        process.stdout.write('\nParameters:\n');
        this.formatInputParameters(input as Record<string, unknown>);
      } else if (input) {
        process.stdout.write(`\nInput: ${JSON.stringify(input)}\n`);
      }

      // Show approval options
      process.stdout.write('\nOptions:\n');
      process.stdout.write('  y) Allow this time\n');
      process.stdout.write('  a) Allow for this session\n');
      process.stdout.write('  n) Deny\n');

      // Prompt for user decision with retry logic
      let decision: ApprovalDecision | null = null;
      while (decision === null) {
        const response = await new Promise<string>((resolve) => {
          rl.question('\nYour choice (y/a/n): ', resolve);
        });

        const normalizedResponse = response.trim().toLowerCase();

        switch (normalizedResponse) {
          case 'y':
            decision = ApprovalDecision.ALLOW_ONCE;
            break;
          case 'a':
            decision = ApprovalDecision.ALLOW_SESSION;
            break;
          case 'n':
            decision = ApprovalDecision.DENY;
            break;
          default:
            process.stdout.write(
              `\n❌ Invalid response: "${response}". Please enter y, a, or n.\n`
            );
            break;
        }
      }

      return decision;
    } finally {
      rl.close();
    }
  }

  private formatInputParameters(input: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(input)) {
      const formattedValue = this.formatParameterValue(value);
      process.stdout.write(`  ${key}: ${formattedValue}\n`);
    }
  }

  private formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      // Truncate very long strings
      if (value.length > 200) {
        return `"${value.substring(0, 200)}...[truncated]"`;
      }
      return `"${value}"`;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }
      const items = value.slice(0, 3).map((item) => this.formatParameterValue(item));
      const suffix = value.length > 3 ? `, ...${value.length - 3} more` : '';
      return `[${items.join(', ')}${suffix}]`;
    } else if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value).slice(0, 3);
      const formatted = entries.map(([k, v]) => `${k}: ${this.formatParameterValue(v)}`);
      const suffix = Object.keys(value).length > 3 ? ', ...' : '';
      return `{ ${formatted.join(', ')}${suffix} }`;
    } else {
      return String(value);
    }
  }
}
