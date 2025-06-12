// ABOUTME: Tool registry that manages all available tools for agents
// ABOUTME: Provides plugin-style architecture for extensible tool ecosystem

import { ShellTool } from "./shell.js";
import { ReadFileTool } from "./read-file.js";
import { WriteFileTool } from "./write-file.js";
import { ListFilesTool } from "./list-files.js";
import { FileSearchTool } from "./file-search.js";
import { JavaScriptTool } from "./javascript.js";
import { AgentDelegateTool } from "./agent-delegate.js";
import { BaseTool } from "./base-tool.js";

interface ToolRegistryOptions {
  activityLogger?: any;
  progressTracker?: any;
  snapshotManager?: any;
  conversationDB?: any;
  snapshotConfig?: {
    enablePreToolSnapshots?: boolean;
    enablePostToolSnapshots?: boolean;
    snapshotOnErrors?: boolean;
  };
}

export class ToolRegistry {
  private tools: Map<string, BaseTool>;
  private activityLogger: any;
  private progressTracker: any;
  private snapshotManager: any;
  private conversationDB: any;
  private snapshotConfig: {
    enablePreToolSnapshots: boolean;
    enablePostToolSnapshots: boolean;
    snapshotOnErrors: boolean;
  };

  constructor(options: ToolRegistryOptions = {}) {
    this.tools = new Map();
    this.activityLogger = options.activityLogger || null;
    this.progressTracker = options.progressTracker || null;
    this.snapshotManager = options.snapshotManager || null;
    this.conversationDB = options.conversationDB || null;

    // Snapshot configuration
    this.snapshotConfig = {
      enablePreToolSnapshots: true,
      enablePostToolSnapshots: true,
      snapshotOnErrors: true,
      ...options.snapshotConfig,
    };
  }

  async initialize() {
    // Register new focused tools
    this.register("shell", new ShellTool());
    this.register("read_file", new ReadFileTool());
    this.register("write_file", new WriteFileTool());
    this.register("list_files", new ListFilesTool());
    this.register("file_search", new FileSearchTool());
    this.register("javascript", new JavaScriptTool());
    this.register("agent_delegate", new AgentDelegateTool());

    // Initialize all tools
    for (const tool of this.tools.values()) {
      if (tool.initialize) {
        await tool.initialize();
      }
    }
  }

  register(name: string, tool: BaseTool): void {
    this.tools.set(name, tool);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  async callTool(name: string, method: string, params: Record<string, any> = {}, sessionId: string | null = null, agent: any = null): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    // All tools must be BaseTool instances
    if (typeof tool.execute !== "function") {
      throw new Error(`Tool '${name}' is not a valid BaseTool`);
    }

    // Log tool execution start
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent(
        "tool_execution_start",
        sessionId,
        null,
        {
          tool: name,
          method,
          params,
        },
      );
    }

    const startTime = Date.now();
    let success = true;
    let result = null;
    let error = null;

    try {
      const toolResult = await tool.execute(method, params, {
        context: { sessionId, agent }
      });
      
      if (toolResult.success) {
        result = toolResult.data;
      } else {
        success = false;
        error = toolResult.error?.message || 'Unknown error';
        throw new Error(error);
      }
    } catch (err) {
      success = false;
      error = err.message;
      throw err;
    } finally {
      // Log tool execution complete
      if (this.activityLogger && sessionId) {
        const duration = Date.now() - startTime;
        await this.activityLogger.logEvent(
          "tool_execution_complete",
          sessionId,
          null,
          {
            success,
            result: success ? result : null,
            error,
            duration_ms: duration,
          },
        );
      }
    }

    return result;
  }

  getToolSchema(name: string): any {
    const tool = this.tools.get(name);
    if (!tool || !tool.getSchema) {
      return null;
    }
    return tool.getSchema();
  }

  getAllSchemas(): Record<string, any> {
    const schemas: Record<string, any> = {};
    for (const [name, tool] of this.tools) {
      if (tool.getSchema) {
        schemas[name] = tool.getSchema();
      }
    }
    return schemas;
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool with automatic snapshot creation
   */
  async callToolWithSnapshots(
    name: string,
    method: string,
    params: Record<string, any> = {},
    sessionId: string | null = null,
    generation: number | null = null,
    agent: any = null,
  ): Promise<any> {
    // If no snapshot manager configured, fall back to regular tool execution
    if (!this.snapshotManager) {
      return this.callTool(name, method, params, sessionId, agent);
    }

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    // All tools must be BaseTool instances
    if (typeof tool.execute !== "function") {
      throw new Error(`Tool '${name}' is not a valid BaseTool`);
    }

    // Create tool call metadata
    const toolCall = {
      toolName: name,
      operation: method,
      parameters: params,
      executionId: this.generateExecutionId(),
      timestamp: new Date().toISOString(),
    };

    // Create pre-tool snapshot
    let preSnapshot = null;
    if (this.snapshotConfig.enablePreToolSnapshots) {
      try {
        preSnapshot = await this.snapshotManager.createPreToolSnapshot(
          toolCall,
          await this.gatherSnapshotContext(sessionId),
          sessionId,
          generation,
        );

        // Log snapshot creation
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent(
            "snapshot_created",
            sessionId,
            null,
            {
              snapshotId: preSnapshot.snapshotId,
              type: "pre-tool",
              toolCall,
            },
          );
        }
      } catch (error) {
        // Log snapshot error but don't fail tool execution
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent(
            "snapshot_error",
            sessionId,
            null,
            {
              error: error.message,
              type: "pre-tool",
              toolCall,
            },
          );
        }
      }
    }

    // Execute the tool
    const startTime = Date.now();
    let success = true;
    let result = null;
    let error = null;

    // Log tool execution start
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent(
        "tool_execution_start",
        sessionId,
        null,
        {
          tool: name,
          method,
          params,
          executionId: toolCall.executionId,
          preSnapshotId: preSnapshot?.snapshotId,
        },
      );
    }

    try {
      result = await tool[method](params);
    } catch (err) {
      success = false;
      error = err.message;
      // Don't re-throw yet, create post-snapshot first
    }

    const duration = Date.now() - startTime;

    // Create execution result metadata
    const executionResult = {
      success,
      result: success ? result : null,
      error,
      duration,
      timestamp: new Date().toISOString(),
    };

    // Create post-tool snapshot
    let postSnapshot = null;
    if (
      this.snapshotConfig.enablePostToolSnapshots ||
      (!success && this.snapshotConfig.snapshotOnErrors)
    ) {
      try {
        postSnapshot = await this.snapshotManager.createPostToolSnapshot(
          toolCall,
          await this.gatherSnapshotContext(sessionId),
          executionResult,
          sessionId,
          generation,
        );

        // Log snapshot creation
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent(
            "snapshot_created",
            sessionId,
            null,
            {
              snapshotId: postSnapshot.snapshotId,
              type: "post-tool",
              toolCall,
              executionResult,
            },
          );
        }
      } catch (snapshotError) {
        // Log snapshot error but don't fail tool execution
        if (this.activityLogger && sessionId) {
          await this.activityLogger.logEvent(
            "snapshot_error",
            sessionId,
            null,
            {
              error: snapshotError.message,
              type: "post-tool",
              toolCall,
            },
          );
        }
      }
    }

    // Log tool execution complete
    if (this.activityLogger && sessionId) {
      await this.activityLogger.logEvent(
        "tool_execution_complete",
        sessionId,
        null,
        {
          success,
          result: success ? result : null,
          error,
          duration_ms: duration,
          executionId: toolCall.executionId,
          preSnapshotId: preSnapshot?.snapshotId,
          postSnapshotId: postSnapshot?.snapshotId,
        },
      );
    }

    // Now throw the error if tool execution failed
    if (!success) {
      throw new Error(error);
    }

    return result;
  }

  /**
   * Generate unique execution ID for tool calls
   */
  generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gather conversation context for snapshot creation
   */
  async gatherSnapshotContext(sessionId: string | null): Promise<any> {
    const context: any = {
      sessionId,
      timestamp: new Date().toISOString(),
    };

    // Add conversation context for debugging snapshots
    if (this.conversationDB && sessionId) {
      try {
        const recentHistory = await this.conversationDB.getConversationHistory(
          sessionId,
          3,
        );
        context.conversationTurns = recentHistory ? recentHistory.length : 0;
        context.recentHistory = recentHistory || [];
      } catch (error) {
        // Ignore errors in snapshot context gathering
        context.conversationTurns = 0;
        context.recentHistory = [];
      }
    }

    return context;
  }
}
