// ABOUTME: Simplified tool execution engine with configuration API and approval integration
// ABOUTME: Handles tool registration, approval checks, and safe execution with simple configuration

import { ToolResult, ToolContext, Tool } from './types.js';
import { ApprovalCallback, ApprovalDecision } from './approval-types.js';
import { BashTool } from './implementations/bash.js';
import { FileReadTool } from './implementations/file-read.js';
import { FileWriteTool } from './implementations/file-write.js';
import { FileEditTool } from './implementations/file-edit.js';
import { FileInsertTool } from './implementations/file-insert.js';
import { FileListTool } from './implementations/file-list.js';
import { RipgrepSearchTool } from './implementations/ripgrep-search.js';
import { FileFindTool } from './implementations/file-find.js';
import { TaskAddTool, TaskListTool, TaskCompleteTool } from './implementations/task-manager.js';
import { DelegateTool } from './implementations/delegate.js';
import { UrlFetchTool } from './implementations/url-fetch.js';

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
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new FileInsertTool(),
      new FileListTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new TaskAddTool(),
      new TaskListTool(),
      new TaskCompleteTool(),
      new DelegateTool(),
      new UrlFetchTool(),
    ];

    this.registerTools(tools);
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> {
    // 1. Check if tool exists
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool '${toolName}' not found` }],
        isError: true,
      };
    }

    // 2. Check approval if callback is configured
    if (this.approvalCallback) {
      try {
        const approval = await this.approvalCallback.requestApproval(toolName, input);

        if (approval === ApprovalDecision.DENY) {
          return {
            content: [{ type: 'text', text: 'Tool execution denied by approval policy' }],
            isError: true,
          };
        }

        // ALLOW_ONCE and ALLOW_SESSION both proceed to execution
      } catch (error) {
        // Approval system failure
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Approval system error',
            },
          ],
          isError: true,
        };
      }
    }

    // 3. Execute the tool
    try {
      const result = await tool.executeTool(input, context);
      return result;
    } catch (error) {
      return {
        content: [
          { type: 'text', text: error instanceof Error ? error.message : 'Unknown error occurred' },
        ],
        isError: true,
      };
    }
  }
}
