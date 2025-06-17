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
        content: [{ type: 'text', text: `Tool '${toolName}' not found` }],
        isError: true,
      };
    }

    try {
      const result = await tool.executeTool(input, context);

      // Track tool usage in registry
      this._registry.trackToolUsage(toolName);

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
