// ABOUTME: Simplified tool execution engine with configuration API and approval integration
// ABOUTME: Handles tool registration, approval checks, and safe execution with simple configuration

import {
  ToolResult,
  ToolContext,
  ToolCall,
  createErrorResult,
} from '~/tools/types';
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

  async requestToolPermission(call: ToolCall, context?: ToolContext): Promise<'granted' | 'pending'> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`Tool '${call.name}' not found`);
    }

    // 2. Check tool policy if session is available
    if (context?.session) {
      // Check if tool is allowed in configuration
      const config = context.session.getEffectiveConfiguration();
      if (config.tools && !config.tools.includes(call.name)) {
        throw new Error(`Tool '${call.name}' not allowed in current configuration`);
      }

      // Check tool policy
      const policy = context.session.getToolPolicy(call.name);

      switch (policy) {
        case 'deny':
          throw new Error(`Tool '${call.name}' execution denied by policy`);

        case 'allow':
          return 'granted'; // Skip approval system

        case 'require-approval':
          // Fall through to approval system
          break;
      }
    }

    // 3. Check approval - fail safe if no callback is configured
    if (!this.approvalCallback) {
      throw new Error('Tool execution requires approval but no approval callback is configured');
    }

    try {
      await this.approvalCallback.requestApproval(call.name, call.arguments);
      return 'granted'; // Approval was granted immediately
    } catch (error) {
      // Check if this is a pending approval (not an error)
      if (error instanceof ApprovalPendingError) {
        return 'pending'; // Approval request was created, waiting for response
      }

      // Other approval system failures
      throw error;
    }
  }

  async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createErrorResult(`Tool '${call.name}' not found`, call.id);
    }

    // 2. Execute the tool directly (permissions already checked)
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
