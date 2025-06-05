// ABOUTME: Tool registry that manages all available tools for agents
// ABOUTME: Provides plugin-style architecture for extensible tool ecosystem

import { ShellTool } from './shell-tool.js';
import { FileTool } from './file-tool.js';
import { JavaScriptTool } from './javascript-tool.js';
import { SearchTool } from './search-tool.js';

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  async initialize() {
    // Register core tools
    this.register('shell', new ShellTool());
    this.register('file', new FileTool());
    this.register('javascript', new JavaScriptTool());
    this.register('search', new SearchTool());

    // Initialize all tools
    for (const tool of this.tools.values()) {
      if (tool.initialize) {
        await tool.initialize();
      }
    }
  }

  register(name, tool) {
    this.tools.set(name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  async callTool(name, method, params) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }
    
    if (typeof tool[method] !== 'function') {
      throw new Error(`Method '${method}' not found on tool '${name}'`);
    }

    return await tool[method](params);
  }

  getToolSchema(name) {
    const tool = this.tools.get(name);
    if (!tool || !tool.getSchema) {
      return null;
    }
    return tool.getSchema();
  }

  getAllSchemas() {
    const schemas = {};
    for (const [name, tool] of this.tools) {
      if (tool.getSchema) {
        schemas[name] = tool.getSchema();
      }
    }
    return schemas;
  }

  listTools() {
    return Array.from(this.tools.keys());
  }
}