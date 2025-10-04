// ABOUTME: Main exports for MCP client integration using official TypeScript SDK
// ABOUTME: Provides clean import interface for MCP functionality

export { MCPConfigLoader } from '@lace/core/config/mcp-config-loader';
export { MCPServerManager } from './server-manager';
export { MCPToolRegistry } from './tool-registry';
export { MCPToolAdapter } from './tool-adapter';

export type {
  MCPConfig,
  MCPServerConfig,
  MCPServerConnection,
  MCPTool,
  CallToolRequest,
  ListToolsRequest,
  Client,
  StdioClientTransport,
} from '@lace/core/config/mcp-types';

export type { ToolPolicy } from '@lace/core/tools/types';
