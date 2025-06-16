// ABOUTME: Tool execution engine with error handling and result management
// ABOUTME: Handles safe execution of tools with proper error catching

import { ToolResult, ToolContext } from './types.js';
import { ToolRegistry } from './registry.js';

export class ToolExecutor {
  constructor(private _registry: ToolRegistry) {}

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolResult> {
    const tool = this._registry.getTool(toolName);
    if (!tool) {
      return {
        success: false,
        content: [],
        error: `Tool '${toolName}' not found`,
      };
    }

    try {
      return await tool.executeTool(input, context);
    } catch (error) {
      return {
        success: false,
        content: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
