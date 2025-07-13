// ABOUTME: Web interface that embeds Next.js server within main app process
// ABOUTME: Provides web UI access to Agent and ThreadManager through shared instances

import { createServer } from 'node:http';
import next from 'next';
import type { Agent } from '~/agents/agent.js';
import type { UserInterface } from '~/commands/types.js';
import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types.js';
import { logger } from '~/utils/logger.js';
import type { LaceRequest } from '~/interfaces/web/types.js';

export interface WebInterfaceOptions {
  port?: number;
  host?: string;
}

/**
 * Web interface that runs an embedded Next.js server
 * Shares Agent and ThreadManager instances with the main application
 */
export class WebInterface implements UserInterface, ApprovalCallback {
  agent: Agent;
  private options: Required<WebInterfaceOptions>;
  private server?: ReturnType<typeof createServer>;
  private nextApp?: ReturnType<typeof next>;
  private isRunning = false;

  constructor(agent: Agent, options: WebInterfaceOptions = {}) {
    this.agent = agent;
    this.options = {
      port: options.port ?? 3000,
      host: options.host ?? 'localhost',
    };
  }

  displayMessage(message: string): void {
    logger.info(`Web Interface: ${message}`);
  }

  clearSession(): void {
    // Create new thread and agent
    const newThreadId = this.agent.generateThreadId();
    this.agent.createThread(newThreadId);
  }

  exit(): void {
    void this.stop().finally(() => {
      process.exit(0);
    });
  }

  /**
   * Handle tool approval requests
   * For now, automatically allow all tools (will be replaced with web UI)
   */
  async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
    // TODO: Implement web-based approval dialog
    logger.info(`Auto-approving tool: ${toolName}`, { input });
    return Promise.resolve(ApprovalDecision.ALLOW_ONCE);
  }

  /**
   * Start the embedded Next.js web server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Web interface is already running');
    }

    this.isRunning = true;

    try {
      // Start the Agent
      await this.agent.start();

      // Create Next.js app with custom app directory
      this.nextApp = next({
        dev: process.env.NODE_ENV !== 'production',
        dir: './src/interfaces/web',
        quiet: false,
      });

      const handle = this.nextApp.getRequestHandler();
      await this.nextApp.prepare();

      // Create custom server that integrates with Next.js
      this.server = createServer((req: LaceRequest, res) => {
        try {
          // Add agent to request context for API routes
          req.laceAgent = this.agent;
          void handle(req, res);
        } catch (err) {
          logger.error('Error handling request', { error: err });
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });

      // Start the server
      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.options.port, this.options.host, () => {
          logger.info(
            `Next.js web interface started on http://${this.options.host}:${this.options.port}`
          );
          console.log(
            `🌐 Lace web interface available at http://${this.options.host}:${this.options.port}`
          );
          console.log(`   Provider: ${this.agent.providerName}`);
          console.log(`   Thread ID: ${this.agent.getCurrentThreadId() || 'none'}`);
          resolve();
        });

        this.server!.on('error', reject);
      });

      // Keep the process running
      await new Promise<void>((resolve) => {
        // Listen for process termination signals
        const cleanup = () => {
          logger.info('Received termination signal, shutting down web interface');
          resolve();
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      });
    } catch (error) {
      this.isRunning = false;
      logger.error('Failed to start web interface', { error });
      throw error;
    }
  }

  /**
   * Stop the web server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    try {
      // Stop the Agent
      this.agent?.stop();

      // Close the server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => {
            logger.info('Web server stopped');
            resolve();
          });
        });
      }

      // Close Next.js app
      if (this.nextApp) {
        await this.nextApp.close();
        logger.info('Next.js app closed');
      }
    } catch (error) {
      logger.error('Error stopping web interface', { error });
      throw error;
    }
  }
}
