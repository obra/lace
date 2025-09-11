// ABOUTME: Tool Discovery & Enumeration system for fast configuration APIs
// ABOUTME: Provides async discovery caching and fast tool enumeration without expensive ToolExecutor creation

import { MCPServerManager } from '~/mcp/server-manager';
import { MCPConfigLoader } from '~/config/mcp-config-loader';
import { logger } from '~/utils/logger';
import type { Project } from '~/projects/project';
import type { MCPServerConfig, DiscoveredTool } from '~/config/mcp-types';

/**
 * Tool Discovery & Enumeration
 *
 * This class provides fast tool enumeration for configuration APIs without
 * the expensive overhead of creating ToolExecutor instances.
 *
 * Discovery Flow:
 * 1. User adds MCP server → discoverAndCacheTools() → async discovery → cache results
 * 2. Configuration API → getAvailableTools() → read cache → immediate response
 * 3. Session startup → refreshCacheForRunningServer() → keep cache current
 *
 * Performance: Configuration APIs go from 5-15 seconds to sub-millisecond.
 */
export class ToolCatalog {
  /**
   * Get all available tools for project (native + cached MCP)
   * FAST: Just reads cached data, no ToolExecutor creation
   */
  static getAvailableTools(project: Project): string[] {
    const nativeTools = [
      'bash',
      'file_read',
      'file_write',
      'file_edit',
      'file_list',
      'ripgrep_search',
      'file_find',
      'delegate',
      'url_fetch',
      'task_create',
      'task_list',
      'task_complete',
      'task_update',
      'task_add_note',
      'task_view',
    ];

    // Get MCP tools from discovery cache
    const mcpServers = project.getMCPServers();
    const mcpTools = Object.entries(mcpServers)
      .filter(([_, config]) => config.enabled)
      .flatMap(([serverId, config]) => {
        // Use discovered tools if available
        if (config.discoveredTools && config.discoveryStatus === 'success') {
          return config.discoveredTools.map((tool) => `${serverId}/${tool.name}`);
        }

        // Fallback to configured tool policies (shows something while discovering)
        return Object.keys(config.tools).map((toolName) => `${serverId}/${toolName}`);
      });

    return [...nativeTools, ...mcpTools];
  }

  /**
   * Discover MCP server tools and cache results (async, non-blocking)
   */
  static discoverAndCacheTools(
    serverId: string,
    config: MCPServerConfig,
    projectDir?: string
  ): Promise<void> {
    // Update config immediately with discovering status
    const pendingConfig = {
      ...config,
      discoveryStatus: 'discovering' as const,
      lastDiscovery: new Date().toISOString(),
    };

    MCPConfigLoader.updateServerConfig(serverId, pendingConfig, projectDir);

    // Start background discovery (don't await)
    void this.performBackgroundDiscovery(serverId, config, projectDir);

    return Promise.resolve();
  }

  /**
   * Refresh tool cache for already-running MCP server
   * Called during session startup when servers are already starting
   */
  static async refreshCacheForRunningServer(
    serverId: string,
    mcpManager: MCPServerManager,
    projectDir: string
  ): Promise<void> {
    try {
      const client = mcpManager.getClient(serverId);
      if (!client) return; // Server not running yet

      const response = await client.listTools();
      const discoveredTools: DiscoveredTool[] = response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }));

      // Update cache (reuse existing method)
      const currentConfig = MCPConfigLoader.loadConfig(projectDir).servers[serverId];
      if (currentConfig) {
        const updatedConfig = {
          ...currentConfig,
          discoveredTools,
          discoveryStatus: 'success' as const,
          lastDiscovery: new Date().toISOString(),
        };

        MCPConfigLoader.updateServerConfig(serverId, updatedConfig, projectDir);
      }
    } catch (error) {
      logger.debug(`Failed to refresh tool cache for ${serverId}:`, error);
      // Don't fail session startup for cache refresh failures
    }
  }

  /**
   * Background discovery implementation
   */
  private static async performBackgroundDiscovery(
    serverId: string,
    config: MCPServerConfig,
    projectDir?: string
  ): Promise<void> {
    const tempManager = new MCPServerManager();

    try {
      logger.debug(`Starting tool discovery for ${serverId}`);

      // Start temporary server for discovery
      await tempManager.startServer(serverId, config);

      // Discover available tools
      const client = tempManager.getClient(serverId);
      if (!client) {
        throw new Error(`Failed to get client for server ${serverId}`);
      }
      const response = await client.listTools();

      const discoveredTools: DiscoveredTool[] = response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }));

      // Update cache with success
      const successConfig = {
        ...config,
        discoveredTools,
        discoveryStatus: 'success' as const,
        lastDiscovery: new Date().toISOString(),
        discoveryError: undefined,
      };

      MCPConfigLoader.updateServerConfig(serverId, successConfig, projectDir);

      logger.info(`Discovered ${discoveredTools.length} tools for ${serverId}`);
    } catch (error) {
      // Update cache with failure
      const failureConfig = {
        ...config,
        discoveryStatus: 'failed' as const,
        discoveryError: error instanceof Error ? error.message : 'Unknown error',
        lastDiscovery: new Date().toISOString(),
      };

      MCPConfigLoader.updateServerConfig(serverId, failureConfig, projectDir);

      logger.warn(
        `Tool discovery failed for ${serverId}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      // Always cleanup temporary server
      await tempManager.shutdown();
    }
  }
}
