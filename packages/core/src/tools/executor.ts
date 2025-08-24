// ABOUTME: Simplified tool execution engine with configuration API and approval integration
// ABOUTME: Handles tool registration, approval checks, and safe execution with simple configuration

import {
  ToolResult,
  ToolContext,
  ToolCall,
  createErrorResult,
  createToolResult,
} from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { BashTool } from '~/tools/implementations/bash';
import { FileReadTool } from '~/tools/implementations/file-read';
import { FileWriteTool } from '~/tools/implementations/file-write';
import { FileEditTool } from '~/tools/implementations/file-edit';
import { FileInsertTool } from '~/tools/implementations/file-insert';
import { FileListTool } from '~/tools/implementations/file-list';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep-search';
import { FileFindTool } from '~/tools/implementations/file-find';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/index';
import { DelegateTool } from '~/tools/implementations/delegate';
import { UrlFetchTool } from '~/tools/implementations/url-fetch';

export class ToolExecutor {
  private tools = new Map<string, Tool>();
  private approvalCallback?: ApprovalCallback;
  private envManager: ProjectEnvironmentManager;

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

  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
  }

  getTool(toolName: string): Tool | undefined {
    return this.tools.get(toolName);
  }

  getAvailableToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getApprovalCallback(): ApprovalCallback | undefined {
    return this.approvalCallback;
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
      new FileInsertTool(),
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

  async requestToolPermission(
    call: ToolCall,
    context?: ToolContext
  ): Promise<'granted' | 'pending' | ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`Tool '${call.name}' not found`);
    }

    // 2. SECURITY: Fail-safe - require agent context for policy enforcement
    if (!context?.agent) {
      return createToolResult(
        'denied',
        [
          {
            type: 'text',
            text: 'Tool execution denied: agent context required for security policy enforcement',
          },
        ],
        call.id
      );
    }

    // 3. Check if tool is marked as safe internal (bypasses all approval)
    if (tool.annotations?.safeInternal === true) {
      return 'granted';
    }

    // 4. Check tool policy with agent context
    const session = await context.agent.getFullSession();
    if (!session) {
      return createToolResult(
        'denied',
        [{ type: 'text', text: 'Session not found for policy enforcement' }],
        call.id
      );
    }

    // Check if tool is allowed in configuration
    const config = session.getEffectiveConfiguration();
    if (config.tools && !config.tools.includes(call.name)) {
      return createToolResult(
        'denied',
        [{ type: 'text', text: `Tool '${call.name}' not allowed in current configuration` }],
        call.id
      );
    }

    // Check tool policy
    const policy = session.getToolPolicy(call.name);

    switch (policy) {
      case 'deny':
        return createToolResult(
          'denied',
          [{ type: 'text', text: `Tool '${call.name}' execution denied by policy` }],
          call.id
        );

      case 'allow':
        return 'granted'; // Skip approval system

      case 'require-approval':
        // Fall through to approval system
        break;
    }

    // 5. Check approval - fail safe if no callback is configured
    if (!this.approvalCallback) {
      throw new Error('Tool execution requires approval but no approval callback is configured');
    }

    try {
      const decision = await this.approvalCallback.requestApproval(call);

      if (decision === ApprovalDecision.ALLOW_ONCE || decision === ApprovalDecision.ALLOW_SESSION) {
        return 'granted';
      } else if (decision === ApprovalDecision.DENY) {
        return createToolResult(
          'denied',
          [{ type: 'text', text: 'Tool execution denied by approval policy' }],
          call.id
        );
      } else {
        throw new Error(`Unknown approval decision: ${String(decision)}`);
      }
    } catch (error) {
      // Check if this is a pending approval (not an error)
      if (error instanceof ApprovalPendingError) {
        return 'pending'; // Approval request was created, waiting for response
      }

      // Other approval system failures (including denial)
      throw error;
    }
  }

  /**
   * @deprecated This method performs redundant permission checks and should be removed.
   * Production code should use: requestToolPermission() followed by executeApprovedTool()
   *
   * Currently kept for backward compatibility with test suite only.
   * TODO: Update all tests to use the proper flow:
   *   1. Call requestToolPermission() to check permissions
   *   2. Call executeApprovedTool() if permission granted
   *
   * No production code uses this method - only tests rely on it.
   */
  async executeTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createErrorResult(`Tool '${call.name}' not found`, call.id);
    }

    // 2. DEPRECATED: This permission check is redundant and exists only for test compatibility
    // Tests should be updated to call requestToolPermission() explicitly
    try {
      const permission = await this.requestToolPermission(call, context);

      // If permission is a ToolResult, it means the tool was denied
      if (typeof permission === 'object' && 'status' in permission) {
        return permission;
      }

      if (permission === 'pending') {
        // This should not happen in the new architecture, but handle gracefully
        return createErrorResult('Tool approval is pending', call.id);
      }
      // permission === 'granted', continue to execution
    } catch (error) {
      // Handle any other errors
      return createErrorResult(error instanceof Error ? error.message : String(error), call.id);
    }

    // 3. Execute the tool (permissions already checked by the redundant check above)
    return this.executeToolDirect(tool, call, context);
  }

  /**
   * Execute a tool that has already been approved.
   * This method bypasses permission checks but ensures proper context setup
   * (temp directory, environment variables, etc.)
   *
   * Used by Agent._executeApprovedTool() when handling TOOL_APPROVAL_RESPONSE events.
   */
  async executeApprovedTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createErrorResult(`Tool '${call.name}' not found`, call.id);
    }

    // 2. Execute directly without permission check (already approved)
    return this.executeToolDirect(tool, call, context);
  }

  private async executeToolDirect(
    tool: Tool,
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolResult> {
    try {
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
        const toolTempDir = await this.createToolTempDirectory(call.id, context);

        // Enhanced context with temp directory information
        toolContext = {
          ...toolContext,
          toolTempDir,
        };
      }

      const result = await tool.execute(call.arguments, toolContext);

      // Ensure the result has the call ID if it wasn't set by the tool
      if (!result.id && call.id) {
        result.id = call.id;
      }
      return result;
    } catch (error) {
      return createErrorResult(
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }
}
