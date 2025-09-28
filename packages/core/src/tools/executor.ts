// ABOUTME: Simplified callback-free tool execution engine
// ABOUTME: Handles tool registration and execution - Agent owns approval flow

import { ToolResult, ToolContext, ToolCall, PermissionOverrideMode } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file_read';
import { FileWriteTool } from '~/tools/implementations/file_write';
import { FileEditTool } from '~/tools/implementations/file_edit';
import { FileListTool } from '~/tools/implementations/file_list';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep_search';
import { FileFindTool } from '~/tools/implementations/file_find';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/index';
import { DelegateTool } from '~/tools/implementations/delegate';
import { UrlFetchTool } from '~/tools/implementations/url_fetch';
import { MCPServerManager } from '~/mcp/server-manager';
import type { MCPServerConnection } from '~/config/mcp-types';
import { MCPToolAdapter } from '~/mcp/tool-adapter';
import { logger } from '~/utils/logger';
import type { Session } from '~/sessions/session';

export class ToolExecutor {
  private tools = new Map<string, Tool>();
  private envManager: ProjectEnvironmentManager;
  private permissionOverrideMode: PermissionOverrideMode = 'normal';

  // Constants for temp directory naming
  private static readonly TOOL_CALL_TEMP_PREFIX = 'tool-call-';

  constructor() {
    this.envManager = new ProjectEnvironmentManager();
  }

  registerTool(name: string, tool: Tool): void {
    this.tools.set(name, tool);
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  getTool(toolName: string): Tool | undefined {
    return this.tools.get(toolName);
  }

  getAvailableToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getAllTools(): Tool[] {
    const nativeTools = this.getNativeTools();
    const mcpTools = this.getMCPTools();
    return [...nativeTools, ...mcpTools];
  }

  setPermissionOverrideMode(mode: PermissionOverrideMode): void {
    this.permissionOverrideMode = mode;
  }

  getEffectivePolicy(tool: Tool, configuredPolicy: string): string {
    switch (this.permissionOverrideMode) {
      case 'yolo':
        return 'allow';

      case 'read-only':
        if (tool.annotations?.readOnlySafe) {
          return 'allow';
        }
        return 'deny';

      case 'normal':
      default:
        return configuredPolicy;
    }
  }

  /**
   * Ensure MCP tool discovery is complete before proceeding (called before LLM calls)
   */
  async ensureMCPToolsReady(timeoutMs: number = 5000): Promise<void> {
    if (this.mcpDiscoveryPromise) {
      try {
        await Promise.race([
          this.mcpDiscoveryPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MCP tool discovery timeout')), timeoutMs)
          ),
        ]);
      } catch (error) {
        logger.warn(`MCP tool discovery timed out after ${timeoutMs}ms:`, error);
        // Continue with whatever tools we have
      }
    }
  }

  private getNativeTools(): Tool[] {
    // Return all registered native tools (non-MCP)
    return Array.from(this.tools.values()).filter((tool) => !tool.name.includes('/'));
  }

  private getMCPTools(): Tool[] {
    // Return already registered MCP tools
    // (Tool discovery happens lazily when tools are actually needed)
    return Array.from(this.tools.values()).filter((tool) => tool.name.includes('/'));
  }

  /**
   * Register MCP tools from a server manager (called by Session)
   */
  registerMCPTools(mcpManager: MCPServerManager): void {
    // Store reference and start discovery in background (non-blocking)
    this.mcpServerManager = mcpManager;
    this.mcpDiscoveryPromise = this.discoverAllMCPTools();
  }

  /**
   * Set session reference for callbacks (called during agent creation)
   */
  setSession(session: Session): void {
    this.session = session;
  }

  private session?: Session;

  private mcpServerManager?: MCPServerManager;
  private mcpDiscoveryPromise?: Promise<void>;

  private async discoverAllMCPTools(): Promise<void> {
    if (!this.mcpServerManager) return;

    try {
      // Clear existing MCP tools
      const mcpToolNames = Array.from(this.tools.keys()).filter((name) => name.includes('/'));
      mcpToolNames.forEach((name) => this.tools.delete(name));

      // Discover tools from all running servers
      const runningServers = this.mcpServerManager
        .getAllServers()
        .filter((server) => server.status === 'running');

      const discoveryPromises = runningServers.map((server) =>
        this.discoverAndRegisterServerTools(server)
      );

      await Promise.all(discoveryPromises);
    } catch (error) {
      logger.warn('Failed to discover MCP tools:', error);
    }
  }

  /**
   * Register MCP tools and wait for discovery to complete (for testing)
   */
  async registerMCPToolsAndWait(mcpManager: MCPServerManager): Promise<void> {
    // Clear existing MCP tools
    const mcpToolNames = Array.from(this.tools.keys()).filter((name) => name.includes('/'));
    mcpToolNames.forEach((name) => this.tools.delete(name));

    // Register tools from all running servers and wait for completion
    const runningServers = mcpManager
      .getAllServers()
      .filter((server) => server.status === 'running');

    const discoveryPromises = runningServers.map((server) =>
      this.discoverAndRegisterServerTools(server)
    );

    await Promise.all(discoveryPromises);
  }

  /**
   * Discover and register tools from a server (async, non-blocking)
   */
  private async discoverAndRegisterServerTools(server: MCPServerConnection): Promise<void> {
    try {
      const serverTools = await this.discoverMCPServerTools(server);

      // Filter tools based on approval policy - don't register disabled tools
      const enabledTools = serverTools.filter((tool) => {
        const [_serverId, toolId] = tool.name.split('/', 2);
        const approvalLevel = server.config.tools[toolId] || 'ask';
        return approvalLevel !== 'disable';
      });

      enabledTools.forEach((tool) => {
        this.tools.set(tool.name, tool);
      });

      logger.debug(
        `Registered ${enabledTools.length}/${serverTools.length} tools from MCP server ${server.id} (filtered out disabled tools)`
      );
    } catch (error) {
      logger.warn(`Failed to discover and register tools from server ${server.id}:`, error);
    }
  }

  private async discoverMCPServerTools(server: MCPServerConnection): Promise<Tool[]> {
    try {
      if (!server.client) return [];

      // Use MCP SDK's listTools() to get available tools
      const result = await server.client.listTools();

      // Create MCPToolAdapter instances for each tool
      const tools = result.tools.map(
        (mcpTool) => new MCPToolAdapter(mcpTool, server.id, server.client!)
      );

      logger.debug(`Discovered ${tools.length} tools from MCP server ${server.id}`);
      return tools;
    } catch (error) {
      logger.warn(`Failed to discover tools from server ${server.id}:`, error);
      return [];
    }
  }

  getEnvironmentManager(): ProjectEnvironmentManager {
    return this.envManager;
  }

  registerAllAvailableTools(): void {
    const tools = [
      new BashTool(),
      new FileReadTool(), // Schema-based file read tool
      new FileWriteTool(),
      new FileEditTool(),
      new FileListTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new TaskCreateTool(),
      new TaskListTool(),
      new TaskCompleteTool(),
      new TaskUpdateTool(),
      new TaskAddNoteTool(),
      new TaskViewTool(),
      new DelegateTool(),
      new UrlFetchTool(),
    ];

    this.registerTools(tools);
  }

  /**
   * Create temp directory for a tool call
   */
  private async createToolTempDirectory(toolCallId: string, context: ToolContext): Promise<string> {
    if (!context.agent) {
      throw new Error('Agent context required for temp directory creation');
    }

    // Get session instance and use its temp directory method
    const session = await context.agent.getFullSession();
    if (!session) {
      throw new Error('Session not found for temp directory creation');
    }
    const sessionTempDir = session.getSessionTempDir();

    // Create tool-specific directory
    const toolTempDir = join(sessionTempDir, `${ToolExecutor.TOOL_CALL_TEMP_PREFIX}${toolCallId}`);
    mkdirSync(toolTempDir, { recursive: true });

    return toolTempDir;
  }

  /**
   * Execute a tool directly without approval complexity.
   * Agent owns approval flow - ToolExecutor just executes when told.
   */
  async execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.getTool(toolCall.name);
    if (!tool) {
      throw new Error(`Tool '${toolCall.name}' not found`);
    }
    // Create enhanced context with environment and temp directory
    let toolContext: ToolContext = context || {};

    // Merge project environment variables if agent is available
    if (context?.agent) {
      const session = await context.agent.getFullSession();
      const projectId = session?.getProjectId();

      // Create merged environment for subprocess execution
      if (projectId) {
        const projectEnv = this.envManager.getMergedEnvironment(projectId);
        toolContext.processEnv = { ...process.env, ...projectEnv };
      }

      // Use the LLM-provided tool call ID and create temp directory
      const toolTempDir = await this.createToolTempDirectory(toolCall.id, context);

      // Get workspace context from session
      const workspaceInfo = session?.getWorkspaceInfo();
      const workspaceManager = session?.getWorkspaceManager();

      // Enhanced context with temp directory, workspace info, and workspace manager
      toolContext = {
        ...toolContext,
        toolTempDir,
        workspaceInfo,
        workspaceManager,
      };
    }

    const result = await tool.execute(toolCall.arguments, toolContext);

    // Ensure the result has the call ID if it wasn't set by the tool
    if (!result.id && toolCall.id) {
      result.id = toolCall.id;
    }
    return result;
  }

  /**
   * Cleanup resources on shutdown (MCP servers are managed by Session)
   */
  async shutdown(): Promise<void> {
    // No cleanup needed - Session manages MCP server lifecycle
  }
}
