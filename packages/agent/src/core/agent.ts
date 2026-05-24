// ABOUTME: Main Agent class - entry point for library usage

import { ProviderCatalogManager } from '@lace/agent/providers/catalog/manager';
import { ProviderInstanceManager } from '@lace/agent/providers/instance/manager';
import { MCPServerManager } from '@lace/agent/mcp/server-manager';
import type { AgentConfig, AgentState } from './types';

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
}
