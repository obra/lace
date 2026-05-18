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

export interface SessionConfig {
  cwd: string;
  connectionId?: string;
  modelId?: string;
  env?: Record<string, string>;
}

export interface PromptParams {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string }
  >;
  outputFormat?: unknown;
}

export interface TurnResult {
  turnId: string;
  stopReason:
    | 'end_turn'
    | 'max_tokens'
    | 'max_turns'
    | 'cancelled'
    | 'budget_exceeded'
    | 'incomplete'
    | 'permission_cancelled';
  content: Array<{ type: 'text'; text: string }>;
  usage: { inputTokens: number; outputTokens: number };
  cost?: number;
}

export type SessionUpdateHandler = (update: SessionUpdate) => void;

export interface SessionUpdate {
  type: string;
  [key: string]: unknown;
}
