// ABOUTME: Tool execution engine with error handling and result management
// ABOUTME: Handles safe execution of tools with proper error catching

import { ToolResult } from './types.js';
import { ToolRegistry } from './registry.js';

export class ToolExecutor {
  constructor(private _registry: ToolRegistry) {}

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this._registry.getTool(toolName);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool '${toolName}' not found`,
      };
    }

    try {
      return await tool.executeTool(input);
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
