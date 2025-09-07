// ABOUTME: TypeScript interfaces for MCP client communication and configuration
// ABOUTME: Defines server configuration and state management types (SDK handles JSON-RPC)

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Discovered tool information from MCP server
export interface DiscoveredTool {
  name: string;
  description?: string;
}

// MCP Server Configuration (matches mcp-config.json structure)
export interface MCPServerConfig {
  command: string; // Executable name
  args?: string[]; // Command arguments
  env?: Record<string, string>; // Environment variables
  cwd?: string; // Working directory
  enabled: boolean;
  tools: Record<string, ApprovalLevel>; // Tool name -> approval policy

  // Tool discovery cache
  discoveredTools?: DiscoveredTool[];
  lastDiscovery?: string; // ISO timestamp
  discoveryError?: string;
  discoveryStatus?: 'never' | 'discovering' | 'success' | 'failed';
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export type ApprovalLevel = 'allow' | 'ask' | 'deny' | 'disable';

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
export type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
export type { CallToolRequest, ListToolsRequest } from '@modelcontextprotocol/sdk/types.js';
export type { Client, StdioClientTransport };
