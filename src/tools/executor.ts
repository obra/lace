// ABOUTME: Simplified tool execution engine with configuration API and approval integration
// ABOUTME: Handles tool registration, approval checks, and safe execution with simple configuration

import { ToolResult, ToolContext, ToolCall, createErrorResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ApprovalCallback, ApprovalDecision, ApprovalPendingError } from '~/tools/approval-types';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
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

  async requestToolPermission(
    call: ToolCall,
    context?: ToolContext
  ): Promise<'granted' | 'pending'> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`Tool '${call.name}' not found`);
    }

    // 2. SECURITY: Fail-safe - require session context for policy enforcement
    if (!context?.session) {
      throw new Error(
        'Tool execution denied: session context required for security policy enforcement'
      );
    }

    // 3. Check tool policy with session context
    const session = context.session;

    // Check if tool is allowed in configuration
    const config = session.getEffectiveConfiguration();
    if (config.tools && !config.tools.includes(call.name)) {
      throw new Error(`Tool '${call.name}' not allowed in current configuration`);
    }

    // Check tool policy
    const policy = session.getToolPolicy(call.name);

    switch (policy) {
      case 'deny':
        throw new Error(`Tool '${call.name}' execution denied by policy`);

      case 'allow':
        return 'granted'; // Skip approval system

      case 'require-approval':
        // Fall through to approval system
        break;
    }

    // 4. Check approval - fail safe if no callback is configured
    if (!this.approvalCallback) {
      throw new Error('Tool execution requires approval but no approval callback is configured');
    }

    try {
      const decision = await this.approvalCallback.requestApproval(call);

      if (decision === ApprovalDecision.ALLOW_ONCE || decision === ApprovalDecision.ALLOW_SESSION) {
        return 'granted';
      } else if (decision === ApprovalDecision.DENY) {
        throw new Error('Tool execution denied by approval policy');
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

  async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createErrorResult(`Tool '${call.name}' not found`, call.id);
    }

    // 2. Backward compatibility: check permissions if not called through new flow
    // The new flow should call requestToolPermission() first, then executeTool()
    // But old integration tests and direct calls should still work
    try {
      const permission = await this.requestToolPermission(call, context);
      if (permission === 'pending') {
        // This should not happen in the new architecture, but handle gracefully
        return createErrorResult('Tool approval is pending', call.id);
      }
      // permission === 'granted', continue to execution
    } catch (error) {
      // Permission denied or other permission error
      return createErrorResult(error instanceof Error ? error.message : String(error), call.id);
    }

    // 3. Execute the tool (permissions already checked)
    return this.executeToolDirect(tool, call, context);
  }

  private async executeToolDirect(
    tool: Tool,
    call: ToolCall,
    context?: ToolContext
  ): Promise<ToolResult> {
    // Set up environment for tool execution
    const originalEnv = process.env;

    try {
      // Apply project environment variables if projectId is available
      if (context?.projectId) {
        const projectEnv = this.envManager.getMergedEnvironment(context.projectId);
        Object.assign(process.env, projectEnv);
      }

      const result = await tool.execute(call.arguments, context);

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
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  }
}
