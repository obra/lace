// ABOUTME: Registry for MCP tools that discovers and manages tools from all configured servers
// ABOUTME: Uses MCP SDK's listTools() method and provides unified interface to ToolExecutor

import { EventEmitter } from 'events';
import { Tool } from '~/tools/tool';
import { MCPToolAdapter } from '~/mcp/tool-adapter';
import { MCPServerManager } from '~/mcp/server-manager';
import { logger } from '~/utils/logger';
import type { MCPConfig } from '~/config/mcp-types';
import type { ToolPolicy } from '~/tools/types';

interface ToolRegistryEvents {
  'tools-updated': (serverId: string, tools: Tool[]) => void;
  'tool-discovery-error': (serverId: string, error: string) => void;
}

export class MCPToolRegistry extends EventEmitter {
  private toolsByServer = new Map<string, Tool[]>();
  private serverManager: MCPServerManager;

  constructor(serverManager: MCPServerManager) {
    super();
    this.serverManager = serverManager;

    // Listen for server status changes to discover tools
    this.serverManager.on('server-status-changed', (serverId: string, status: string) => {
      if (status === 'running') {
        this.discoverServerTools(serverId).catch((error: unknown) => {
          this.emit(
            'tool-discovery-error',
            serverId,
            error instanceof Error ? error.message : String(error)
          );
        });
      } else if (status === 'stopped' || status === 'failed') {
        this.clearServerTools(serverId);
      }
    });
  }

  /**
   * Initialize registry with configuration and start tool discovery
   */
  async initialize(config: MCPConfig): Promise<void> {
    // Start all enabled servers
    const startPromises = Object.entries(config.servers)
      .filter(([_, serverConfig]) => serverConfig.enabled)
      .map(([serverId, serverConfig]) =>
        this.serverManager.startServer(serverId, serverConfig).catch((error: unknown) => {
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
  private async discoverServerTools(serverId: string): Promise<void> {
    const client = this.serverManager.getClient(serverId);
    if (!client) {
      this.emit('tool-discovery-error', serverId, 'No client available for server');
      return;
    }

    try {
      // Use MCP SDK's high-level listTools method
      const result = await client.listTools();

      const adaptedTools = result.tools.map(
        (mcpTool) => new MCPToolAdapter(mcpTool, serverId, client)
      );

      this.toolsByServer.set(serverId, adaptedTools);
      this.emit('tools-updated', serverId, adaptedTools);
    } catch (error) {
      this.emit(
        'tool-discovery-error',
        serverId,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Clear tools for a server that has stopped
   */
  private clearServerTools(serverId: string): void {
    this.toolsByServer.delete(serverId);
    this.emit('tools-updated', serverId, []);
  }

  /**
   * Get all tools from all servers, filtered by approval policies
   */
  getAvailableTools(config: MCPConfig): Tool[] {
    const allTools: Tool[] = [];

    for (const [serverId, tools] of this.toolsByServer.entries()) {
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
    return this.toolsByServer.get(serverId) || [];
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
      .map((server) => this.discoverServerTools(server.id));

    await Promise.all(refreshPromises);
  }

  /**
   * Cleanup registry
   */
  async shutdown(): Promise<void> {
    this.toolsByServer.clear();
    await this.serverManager.shutdown();
  }
}
