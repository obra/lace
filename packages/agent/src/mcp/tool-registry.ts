// ABOUTME: Registry for MCP tools that discovers and manages tools from all configured servers
// ABOUTME: Uses MCP SDK's listTools() method and provides unified interface to ToolExecutor

import { EventEmitter } from 'events';
import { Tool } from '@lace/agent/tools/tool';
import { MCPToolAdapter } from './tool-adapter';
import { MCPServerManager } from './server-manager';
import { logger } from '@lace/agent/utils/logger';
import type { MCPConfig } from '@lace/agent/config/mcp-types';
import type { ToolPolicy } from '@lace/agent/tools/types';
import { HostToolRuntime } from '@lace/agent/tools/runtime/host';

export class MCPToolRegistry extends EventEmitter {
  private toolsByConnection = new Map<string, Tool[]>();
  private serverManager: MCPServerManager;

  constructor(serverManager: MCPServerManager) {
    super();
    this.serverManager = serverManager;

    // Listen for server status changes to discover tools
    this.serverManager.on(
      'server-status-changed',
      (serverId: string, status: string, connectionKey?: string) => {
        const key = connectionKey ?? serverId;
        if (status === 'running') {
          this.discoverServerTools(key).catch((error: unknown) => {
            this.emit(
              'tool-discovery-error',
              serverId,
              error instanceof Error ? error.message : String(error)
            );
          });
        } else if (status === 'stopped' || status === 'failed') {
          this.clearServerTools(key, serverId);
        }
      }
    );
  }

  /**
   * Initialize registry with configuration and start tool discovery
   */
  async initialize(config: MCPConfig): Promise<void> {
    // Start all enabled servers
    const startPromises = Object.entries(config.servers)
      .filter(([_, serverConfig]) => serverConfig.enabled)
      .map(([serverId, serverConfig]) =>
        this.serverManager
          .startServer({
            serverId,
            config: { ...serverConfig, placement: serverConfig.placement ?? 'host' },
            runtime: new HostToolRuntime({ id: `mcp-registry:${serverId}`, cwd: process.cwd() }),
            hostCwd: process.cwd(),
          })
          .catch((error: unknown) => {
            logger.error(`Failed to start MCP server ${serverId}:`, {
              serverId,
              error: error instanceof Error ? error.message : String(error),
            });
            // Don't fail entire initialization if one server fails
          })
      );

    await Promise.all(startPromises);
  }

  /**
   * Discover tools from a specific server using MCP SDK
   */
  private async discoverServerTools(connectionKey: string): Promise<void> {
    const server = this.serverManager.getServer(connectionKey);
    const client = server?.client;
    if (!client) {
      this.emit(
        'tool-discovery-error',
        server?.id ?? connectionKey,
        'No client available for server'
      );
      return;
    }

    try {
      // Use MCP SDK's high-level listTools method
      const result = await client.listTools();

      const adaptedTools = result.tools.map(
        (mcpTool) => new MCPToolAdapter(mcpTool, server.id, client)
      );

      this.toolsByConnection.set(connectionKey, adaptedTools);
      this.emit('tools-updated', server.id, adaptedTools);
    } catch (error) {
      this.emit(
        'tool-discovery-error',
        server.id,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Clear tools for a server that has stopped
   */
  private clearServerTools(connectionKey: string, serverId: string): void {
    this.toolsByConnection.delete(connectionKey);
    this.emit('tools-updated', serverId, []);
  }

  /**
   * Get all tools from all servers, filtered by approval policies
   */
  getAvailableTools(config: MCPConfig): Tool[] {
    const allTools: Tool[] = [];

    for (const [connectionKey, tools] of this.toolsByConnection.entries()) {
      const server = this.serverManager.getServer(connectionKey);
      const serverId = server?.id;
      if (!serverId) continue;

      const serverConfig = config.servers[serverId];
      if (!serverConfig?.enabled) {
        continue;
      }

      // Filter tools based on approval policies
      const enabledTools = tools.filter((tool) => {
        const toolName = tool.name.replace(`${serverId}/`, ''); // Remove server prefix
        const approvalLevel = serverConfig.tools[toolName];

        // Don't include disabled tools
        return approvalLevel !== 'disable';
      });

      allTools.push(...enabledTools);
    }

    return allTools;
  }

  /**
   * Get tools from a specific server
   */
  getServerTools(serverId: string): Tool[] {
    const matches = Array.from(this.toolsByConnection.entries()).filter(([connectionKey]) => {
      const server = this.serverManager.getServer(connectionKey);
      return server?.id === serverId;
    });
    if (matches.length !== 1) return [];
    return matches[0]?.[1] ?? [];
  }

  /**
   * Get approval level for a specific tool
   */
  getToolApprovalLevel(config: MCPConfig, toolName: string): ToolPolicy {
    // Tool name format is "serverId/toolName"
    const [serverId, actualToolName] = toolName.split('/', 2);

    if (!serverId || !actualToolName) {
      return 'ask'; // Default for malformed names
    }

    const serverConfig = config.servers[serverId];
    return serverConfig?.tools[actualToolName] || 'ask';
  }

  /**
   * Refresh tools from all running servers
   */
  async refreshAllTools(): Promise<void> {
    const refreshPromises = this.serverManager
      .getAllServers()
      .filter((server) => server.status === 'running')
      .map((server) => this.discoverServerTools(server.connectionKey));

    await Promise.all(refreshPromises);
  }

  /**
   * Cleanup registry
   */
  async shutdown(): Promise<void> {
    this.toolsByConnection.clear();
    await this.serverManager.shutdown();
  }
}
