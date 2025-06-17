// ABOUTME: Tool registry for managing available tools and their discovery
// ABOUTME: Handles tool registration and provides tools for agent execution

import { Tool } from './types.js';

export interface ToolMetadata {
  registeredAt: Date;
  lastUsed?: Date;
  usageCount: number;
}

export interface ToolWithMetadata {
  tool: Tool;
  metadata: ToolMetadata;
}

export class ToolRegistry {
  private _tools = new Map<string, Tool>();
  private _metadata = new Map<string, ToolMetadata>();

  registerTool(tool: Tool): void {
    this._tools.set(tool.name, tool);
    this._metadata.set(tool.name, {
      registeredAt: new Date(),
      usageCount: 0,
    });
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

  clear(): void {
    this._tools.clear();
    this._metadata.clear();
  }

  getToolsWithMetadata(): ToolWithMetadata[] {
    return Array.from(this._tools.entries()).map(([name, tool]) => ({
      tool,
      metadata: this._metadata.get(name) || this._createDefaultMetadata(),
    }));
  }

  trackToolUsage(toolName: string): void {
    const metadata = this._metadata.get(toolName);
    if (metadata) {
      metadata.usageCount++;
      metadata.lastUsed = new Date();
    }
  }

  getReadOnlyTools(): Tool[] {
    return this.getAllTools().filter((tool) => tool.annotations?.readOnlyHint === true);
  }

  getDestructiveTools(): Tool[] {
    return this.getAllTools().filter((tool) => tool.annotations?.destructiveHint === true);
  }

  getIdempotentTools(): Tool[] {
    return this.getAllTools().filter((tool) => tool.annotations?.idempotentHint === true);
  }

  getOpenWorldTools(): Tool[] {
    return this.getAllTools().filter((tool) => tool.annotations?.openWorldHint === true);
  }

  getToolsByTitle(titleSubstring: string): Tool[] {
    return this.getAllTools().filter((tool) => tool.annotations?.title?.includes(titleSubstring));
  }

  private _createDefaultMetadata(): ToolMetadata {
    return {
      registeredAt: new Date(),
      usageCount: 0,
    };
  }
}
