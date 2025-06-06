// ABOUTME: Tool registry that manages all available tools for agents
// ABOUTME: Provides plugin-style architecture for extensible tool ecosystem

import { ShellTool } from './shell-tool.js';
import { FileTool } from './file-tool.js';
import { JavaScriptTool } from './javascript-tool.js';
import { SearchTool } from './search-tool.js';
import { TaskTool } from './task-tool.js';

export class ToolRegistry {
  constructor(options = {}) {
    this.tools = new Map();
    this.activityLogger = options.activityLogger || null;
    this.progressTracker = options.progressTracker || null;
  }

  async initialize() {
    // Register core tools
    this.register('shell', new ShellTool());
    this.register('file', new FileTool());
    this.register('javascript', new JavaScriptTool());
    this.register('search', new SearchTool());
    this.register('task', new TaskTool({ progressTracker: this.progressTracker }));

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

  async callTool(name, method, params, sessionId = null, agent = null) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }
    
    if (typeof tool[method] !== 'function') {
      throw new Error(`Method '${method}' not found on tool '${name}'`);
    }

    // Set agent context for TaskTool
    if (name === 'task' && agent && typeof tool.setAgent === 'function') {
      tool.setAgent(agent);
      if (sessionId && typeof tool.setSessionId === 'function') {
        tool.setSessionId(sessionId);
      }
      if (this.progressTracker && typeof tool.setProgressTracker === 'function') {
        tool.setProgressTracker(this.progressTracker);
      }
    }

    // Log tool execution start
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent('tool_execution_start', sessionId, null, {
        tool: name,
        method: method,
        params: params
      });
    }

    const startTime = Date.now();
    let success = true;
    let result = null;
    let error = null;

    try {
      result = await tool[method](params);
    } catch (err) {
      success = false;
      error = err.message;
      throw err;
    } finally {
      // Log tool execution complete
      if (this.activityLogger && sessionId) {
        const duration = Date.now() - startTime;
        await this.activityLogger.logEvent('tool_execution_complete', sessionId, null, {
          success: success,
          result: success ? result : null,
          error: error,
          duration_ms: duration
        });
      }
    }

    return result;
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