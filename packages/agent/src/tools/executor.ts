// ABOUTME: Simplified callback-free tool execution engine
// ABOUTME: Handles tool registration and execution - Agent owns approval flow

import { ToolResult, ToolContext, ToolCall, PermissionOverrideMode } from './types';
import { Tool } from './tool';
import { ProjectEnvironmentManager } from '@lace/agent/projects/environment-variables';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { BashTool } from './implementations/bash';
import { FileReadTool } from './implementations/file_read';
import { FileWriteTool } from './implementations/file_write';
import { FileEditTool } from './implementations/file_edit';
import { RipgrepSearchTool } from './implementations/ripgrep_search';
import { FileFindTool } from './implementations/file_find';
import { UrlFetchTool } from './implementations/url_fetch';
import { DelegateTool } from './implementations/delegate';
import { JobOutputTool } from './implementations/job_output';
import { JobsListTool } from './implementations/jobs_list';
import { JobKillTool } from './implementations/job_kill';
import { JobNotifyTool } from './implementations/job_notify';
import { TodoReadTool } from './implementations/todo_read';
import { TodoWriteTool } from './implementations/todo_write';
import { UseSkillTool } from './implementations/use-skill-tool';
import { ManageRemindersTool } from './implementations/manage_reminders';
import { MCPServerManager } from '../mcp/server-manager';
import type { SkillRegistry } from '@lace/agent/skills';
import type { MCPServerConnection } from '@lace/agent/config/mcp-types';
import { MCPToolAdapter } from '../mcp/tool-adapter';
import { logger } from '@lace/agent/utils/logger';
import type { JobManager } from '@lace/agent/jobs/job-manager';
import type { PersonaRegistry } from '@lace/agent/config/persona-registry';

export interface RegisterToolsOptions {
  /** PersonaRegistry to wire into DelegateTool. Defaults to the global singleton. */
  personaRegistry?: PersonaRegistry;
}

/**
 * Names of all lace builtin tools registered by `registerAllAvailableTools`.
 *
 * These are platform tools that should always be available to any persona —
 * persona `tools:` frontmatter is an additive specialization layer, not a
 * replacement allowlist. Keep in sync with the tool list in
 * `registerAllAvailableTools` below.
 *
 * `use_skill` is included here because it is unconditionally registered
 * when a SkillRegistry is wired in (always, for session/new).
 */
export const LACE_BUILTIN_TOOL_NAMES = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'ripgrep_search',
  'file_find',
  'url_fetch',
  'delegate',
  'job_output',
  'jobs_list',
  'job_kill',
  'job_notify',
  'todo_read',
  'todo_write',
  'manage_reminders',
  'use_skill',
] as const;

export class ToolExecutor {
  private tools = new Map<string, Tool>();
  private envManager: ProjectEnvironmentManager;
  private permissionOverrideMode: PermissionOverrideMode = 'normal';
  private jobManager?: JobManager;

  // Constants for temp directory naming
  private static readonly TOOL_CALL_TEMP_PREFIX = 'tool-call-';

  constructor() {
    this.envManager = new ProjectEnvironmentManager();
  }

  /**
   * Set the JobManager for job-related tools.
   * Called during executor setup when a session has an active JobManager.
   */
  setJobManager(jobManager: JobManager): void {
    this.jobManager = jobManager;
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
    // PRI-1804 #2: tools must be returned in a deterministic order so the
    // tools-array prefix is byte-stable across sessions. Otherwise MCP
    // discovery race ordering busts the system+tools cache on every new
    // session. Sort by name within each group (native first, MCP second)
    // so the relative grouping is preserved.
    const nativeTools = this.getNativeTools().sort((a, b) => a.name.localeCompare(b.name));
    const mcpTools = this.getMCPTools().sort((a, b) => a.name.localeCompare(b.name));
    return [...nativeTools, ...mcpTools];
  }

  setPermissionOverrideMode(mode: PermissionOverrideMode): void {
    this.permissionOverrideMode = mode;
  }

  getEffectivePolicy(tool: Tool, configuredPolicy: string): string {
    // Respect explicit 'disable' policy even in override modes
    if (configuredPolicy === 'disable') {
      return 'deny';
    }

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
      // Note: MCPToolAdapter extends core Tool - cast is safe, will be cleaned up when MCP moves to agent
      const tools = result.tools.map(
        (mcpTool) => new MCPToolAdapter(mcpTool, server.id, server.client!) as unknown as Tool
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

  registerAllAvailableTools(
    skillRegistry?: SkillRegistry,
    options: RegisterToolsOptions = {}
  ): void {
    const tools: Tool[] = [
      new BashTool(),
      new FileReadTool(), // Schema-based file read tool
      new FileWriteTool(),
      new FileEditTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new UrlFetchTool(),
      new DelegateTool({ personaRegistry: options.personaRegistry }),
      new JobOutputTool(),
      new JobsListTool(),
      new JobKillTool(),
      new JobNotifyTool(),
      new TodoReadTool(),
      new TodoWriteTool(),
      new ManageRemindersTool(),
    ];

    // Add skill tool if registry is provided
    if (skillRegistry) {
      tools.push(new UseSkillTool(skillRegistry));
    }

    this.registerTools(tools);
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

    if (!toolContext.toolTempDir && toolContext.toolTempRoot) {
      const toolTempDir = join(
        toolContext.toolTempRoot,
        `${ToolExecutor.TOOL_CALL_TEMP_PREFIX}${toolCall.id}`
      );
      mkdirSync(toolTempDir, { recursive: true });
      toolContext = { ...toolContext, toolTempDir };
    }

    // Merge project environment variables (agent runtime provides projectId)
    if (toolContext.projectId) {
      const projectEnv = this.envManager.getMergedEnvironment(toolContext.projectId);
      toolContext = {
        ...toolContext,
        processEnv: { ...process.env, ...projectEnv, ...(toolContext.processEnv || {}) },
      };
    }

    // Inject jobManager for job-related tools (if not already in context)
    if (this.jobManager && !toolContext.jobManager) {
      toolContext = { ...toolContext, jobManager: this.jobManager };
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
