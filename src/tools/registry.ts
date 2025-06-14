// ABOUTME: Tool registry for managing available tools and their discovery
// ABOUTME: Handles tool registration and provides tools for agent execution

import { Tool } from './types.js';

export class ToolRegistry {
  private _tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    this._tools.set(tool.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this._tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this._tools.keys());
  }
}
