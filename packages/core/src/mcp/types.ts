// ABOUTME: TypeScript interfaces for MCP client communication and configuration
// ABOUTME: Defines server configuration and state management types (SDK handles JSON-RPC)

import type { Client } from '../../../vendor/typescript-sdk/src/client/index.js';
import type { StdioClientTransport } from '../../../vendor/typescript-sdk/src/client/stdio.js';

// MCP Server Configuration (matches mcp-config.json structure)
export interface MCPServerConfig {
  command: string; // Executable name
  args?: string[]; // Command arguments
  env?: Record<string, string>; // Environment variables
  cwd?: string; // Working directory
  enabled: boolean;
  tools: Record<string, ApprovalLevel>; // Tool name -> approval policy
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export type ApprovalLevel =
  | 'disable'
  | 'deny'
  | 'require-approval'
  | 'allow-once'
  | 'allow-session'
  | 'allow-project'
  | 'allow-always';

// Runtime server connection state
export interface MCPServerConnection {
  id: string;
  config: MCPServerConfig;
  status: 'stopped' | 'starting' | 'running' | 'failed';
  client?: Client; // MCP SDK client instance
  transport?: StdioClientTransport; // MCP SDK transport instance
  lastError?: string;
  connectedAt?: Date;
}

// Re-export key SDK types for convenience
export type { Tool as MCPTool } from '../../../vendor/typescript-sdk/src/types.js';
export type {
  CallToolRequest,
  ListToolsRequest,
} from '../../../vendor/typescript-sdk/src/types.js';
