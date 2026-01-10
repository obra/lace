// ABOUTME: Main Agent class - entry point for library usage

import { ProviderCatalogManager } from '@lace/agent/providers/catalog/manager';
import { ProviderInstanceManager } from '@lace/agent/providers/instance/manager';
import { MCPServerManager } from '@lace/agent/mcp/server-manager';
import { Session } from './session';
import type { AgentConfig, AgentState, SessionConfig } from './types';

export class Agent {
  readonly laceDir: string;
  private readonly config: AgentConfig;
  private state: AgentState;

  constructor(config: AgentConfig) {
    this.laceDir = config.laceDir;
    this.config = {
      executionMode: 'execute',
      approvalMode: 'ask',
      ...config,
    };

    this.state = {
      initialized: false,
      providerCatalog: new ProviderCatalogManager(),
      providerCatalogLoaded: false,
      providerInstances: new ProviderInstanceManager(),
      mcpServerManager: new MCPServerManager(),
    };
  }

  get isInitialized(): boolean {
    return this.state.initialized;
  }

  async initialize(): Promise<void> {
    if (this.state.initialized) return;

    // Load provider catalog
    await this.state.providerCatalog.loadCatalogs();
    this.state.providerCatalogLoaded = true;
    this.state.initialized = true;
  }

  /**
   * Create a new session with the given configuration
   */
  async createSession(config: SessionConfig): Promise<Session> {
    if (!this.state.initialized) {
      await this.initialize();
    }
    return Session.create(config);
  }

  /**
   * Load an existing session by ID
   */
  async loadSession(sessionId: string): Promise<Session> {
    if (!this.state.initialized) {
      await this.initialize();
    }
    return Session.load(sessionId);
  }

  /**
   * List all available sessions, optionally filtered by cwd
   */
  async listSessions(cwd?: string): Promise<
    Array<{
      sessionId: string;
      cwd: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>
  > {
    if (!this.state.initialized) {
      await this.initialize();
    }
    return Session.list(cwd);
  }
}
