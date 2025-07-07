// ABOUTME: Simplified tool execution engine with configuration API and approval integration
// ABOUTME: Handles tool registration, approval checks, and safe execution with simple configuration

import { ToolResult, ToolContext, ToolCall, createErrorResult } from '~/tools/types.js';
import { Tool } from '~/tools/tool.js';
import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types.js';
import { BashTool } from '~/tools/implementations/bash.js';
import { FileReadTool } from '~/tools/implementations/file-read.js';
import { FileWriteTool } from '~/tools/implementations/file-write.js';
import { FileEditTool } from '~/tools/implementations/file-edit.js';
import { FileInsertTool } from '~/tools/implementations/file-insert.js';
import { FileListTool } from '~/tools/implementations/file-list.js';
import { RipgrepSearchTool } from '~/tools/implementations/ripgrep-search.js';
import { FileFindTool } from '~/tools/implementations/file-find.js';
import {
  TaskCreateTool,
  TaskListTool,
  TaskCompleteTool,
  TaskUpdateTool,
  TaskAddNoteTool,
  TaskViewTool,
} from '~/tools/implementations/task-manager/index.js';
import { DelegateTool } from '~/tools/implementations/delegate.js';
import { UrlFetchTool } from '~/tools/implementations/url-fetch.js';

export class ToolExecutor {
  private tools = new Map<string, Tool>();
  private approvalCallback?: ApprovalCallback;

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

  async executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createErrorResult(`Tool '${call.name}' not found`, call.id);
    }

    // 2. Check approval if callback is configured
    if (this.approvalCallback) {
      try {
        const approval = await this.approvalCallback.requestApproval(call.name, call.arguments);

        if (approval === ApprovalDecision.DENY) {
          return createErrorResult('Tool execution denied by approval policy', call.id);
        }

        // ALLOW_ONCE and ALLOW_SESSION both proceed to execution
      } catch (error) {
        // Approval system failure
        return createErrorResult(
          error instanceof Error ? error.message : 'Approval system error',
          call.id
        );
      }
    }

    // 3. Execute the tool
    try {
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
    }
  }
}
