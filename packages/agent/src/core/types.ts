// ABOUTME: Core types for the Agent library API

import type { MCPServerManager } from '@lace/agent/mcp/server-manager';
import type { ProviderCatalogManager } from '@lace/agent/providers/catalog/manager';
import type { ProviderInstanceManager } from '@lace/agent/providers/instance/manager';

export interface AgentConfig {
  laceDir: string;
  executionMode?: 'plan' | 'execute';
  approvalMode?: 'ask' | 'auto-edit' | 'auto-full' | 'deny';
}

export interface AgentState {
  initialized: boolean;
  providerCatalog: ProviderCatalogManager;
  providerCatalogLoaded: boolean;
  providerInstances: ProviderInstanceManager;
  mcpServerManager: MCPServerManager;
}

export interface SessionUpdate {
  type: string;
  [key: string]: unknown;
}
