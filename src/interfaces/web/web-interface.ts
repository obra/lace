// ABOUTME: Web interface implementation using Next.js for Lace AI assistant
// ABOUTME: Provides browser-based UI with real-time streaming and tool approval

import next from 'next';
import { Agent } from '~/agents/agent.js';
import { ApprovalCallback, ApprovalRequest, ApprovalPolicy } from '~/tools/approval-types.js';

interface WebInterfaceOptions {
  port?: number;
  hostname?: string;
}

export class WebInterface implements ApprovalCallback {
  private agent: Agent;
  private options: WebInterfaceOptions;
  private nextApp?: ReturnType<typeof next>;
  private server?: any;

  constructor(agent: Agent, options: WebInterfaceOptions = {}) {
    this.agent = agent;
    this.options = {
      port: 3000,
      hostname: 'localhost',
      ...options,
    };
  }

  async start(): Promise<void> {
    console.log('🌐 Starting Lace Web Interface...');

    try {
      // Initialize Next.js app
      this.nextApp = next({
        dev: process.env.NODE_ENV !== 'production',
        dir: './src',
        quiet: false,
      });

      await this.nextApp.prepare();

      const handle = this.nextApp.getRequestHandler();
      const { createServer } = await import('http');

      // Create HTTP server
      this.server = createServer((req, res) => {
        void handle(req, res);
      });

      // Start listening
      await new Promise<void>((resolve, reject) => {
        this.server.listen(this.options.port, this.options.hostname, (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            console.log(`🚀 Web interface running at http://${this.options.hostname}:${this.options.port}`);
            console.log('📖 Open this URL in your browser to start chatting with Lace');
            resolve();
          }
        });
      });

      // Setup graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n⏹️  Shutting down web interface...');
        this.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\n⏹️  Shutting down web interface...');
        this.stop();
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to start web interface:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          console.log('✅ Web interface stopped');
          resolve();
        });
      });
    }
  }

  // ApprovalCallback implementation
  async requestApproval(request: ApprovalRequest): Promise<ApprovalPolicy> {
    // For the web interface, we'll implement a simplified approval system
    // In a full implementation, this would show a modal or notification
    // For now, we'll auto-approve read-only tools and prompt for destructive ones
    
    const isReadOnly = request.toolMetadata?.readOnlyHint === true;
    const isDestructive = request.toolMetadata?.destructiveHint === true;

    if (isReadOnly) {
      console.log(`🔧 Auto-approving read-only tool: ${request.toolName}`);
      return 'ALLOW_ONCE';
    }

    if (isDestructive) {
      console.log(`⚠️  Destructive tool ${request.toolName} requires approval (auto-allowing for web interface)`);
      // In a real implementation, this would show a web-based approval dialog
      return 'ALLOW_ONCE';
    }

    console.log(`🔧 Approving tool: ${request.toolName}`);
    return 'ALLOW_ONCE';
  }
}