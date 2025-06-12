// ABOUTME: Unit tests for ToolRegistry class
// ABOUTME: Tests tool registration, method calls, activity logging, and snapshot integration

import { jest, describe, test, beforeEach, afterEach, expect } from "@jest/globals";
import { ToolRegistry } from "@/tools/tool-registry.js";

// Mock tool classes
class MockShellTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "Shell command execution",
      methods: {
        execute: {
          description: "Execute shell command",
          parameters: {
            command: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async execute(params) {
    return { output: `Executed: ${params.command}`, success: true };
  }
}

class MockFileTool {
  async initialize() {}
  
  getMetadata() {
    return {
      description: "File system operations",
      methods: {
        read: {
          description: "Read file",
          parameters: {
            path: { type: "string", required: true }
          }
        },
        write: {
          description: "Write file", 
          parameters: {
            path: { type: "string", required: true },
            content: { type: "string", required: true }
          }
        }
      }
    };
  }
  
  async read(params) {
    return { content: `File content from ${params.path}` };
  }
  
  async write(params) {
    return { bytesWritten: params.content.length, success: true };
  }
}

class MockAgentDelegateTool {
  async initialize() {}
  
  async execute(method, params, options) {
    return {
      success: true,
      data: `Mocked ${method} result`
    };
  }
  
  getMetadata() {
    return {
      name: 'agent_delegate',
      description: 'Mock agent delegate tool',
      methods: {
        delegate_task: { description: 'Mock delegate task' },
      }
    };
  }
}

// Mock all tool modules
jest.mock("@/tools/shell.js", () => ({
  ShellTool: MockShellTool
}));

jest.mock("@/tools/read-file.js", () => ({
  ReadFileTool: MockFileTool
}));

jest.mock("@/tools/write-file.js", () => ({
  WriteFileTool: MockFileTool
}));

jest.mock("@/tools/list-files.js", () => ({
  ListFilesTool: MockFileTool
}));

jest.mock("@/tools/javascript.js", () => ({
  JavaScriptTool: class {
    async initialize() {}
    getMetadata() { return { description: "JavaScript execution" }; }
    async evaluate() { return { result: 42 }; }
  }
}));

jest.mock("@/tools/file-search.js", () => ({
  FileSearchTool: class {
    async initialize() {}
    getMetadata() { return { description: "Search operations" }; }
    async find() { return { matches: [] }; }
  }
}));

jest.mock("@/tools/agent-delegate.js", () => ({
  AgentDelegateTool: MockAgentDelegateTool
}));

describe("ToolRegistry", () => {
  let registry;
  let mockActivityLogger;
  let mockProgressTracker;
  let mockSnapshotManager;
  let mockConversationDB;

  beforeEach(async () => {
    mockActivityLogger = {
      logEvent: jest.fn()
    };

    mockProgressTracker = {
      trackProgress: jest.fn(),
      updateProgress: jest.fn()
    };

    mockSnapshotManager = {
      createPreToolSnapshot: jest.fn(() => ({ snapshotId: "pre-123" })),
      createPostToolSnapshot: jest.fn(() => ({ snapshotId: "post-456" }))
    };

    mockConversationDB = {
      getConversationHistory: jest.fn(() => [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" }
      ])
    };

    registry = new ToolRegistry({
      activityLogger: mockActivityLogger,
      progressTracker: mockProgressTracker,
      snapshotManager: mockSnapshotManager,
      conversationDB: mockConversationDB
    });

    await registry.initialize();
  });

  describe("Initialization and Registration", () => {
    test("should initialize with core tools", () => {
      const tools = registry.listTools();
      
      expect(tools).toContain("shell");
      expect(tools).toContain("file");
      expect(tools).toContain("javascript");
      expect(tools).toContain("search");
      expect(tools).toContain("task");
    });

    test("should register custom tools", () => {
      const customTool = {
        getMetadata: () => ({ description: "Custom tool" }),
        customMethod: async () => ({ result: "custom" })
      };

      registry.register("custom", customTool);

      expect(registry.get("custom")).toBe(customTool);
      expect(registry.listTools()).toContain("custom");
    });

    test("should initialize all tools during setup", async () => {
      const mockTool = {
        initialize: jest.fn(),
        getMetadata: () => ({ description: "Test tool" })
      };

      const newRegistry = new ToolRegistry();
      newRegistry.register("mock", mockTool);
      await newRegistry.initialize();

      expect(mockTool.initialize).toHaveBeenCalled();
    });
  });

  describe("Tool Schema Management", () => {
    test("should get schema for individual tool", () => {
      const schema = registry.getToolSchema("file");
      
      expect(schema).toBeDefined();
      expect(schema.description).toBe("File system operations");
      expect(schema.methods).toBeDefined();
      expect(schema.methods.read).toBeDefined();
      expect(schema.methods.write).toBeDefined();
    });

    test("should return null for non-existent tool schema", () => {
      const schema = registry.getToolSchema("nonexistent");
      expect(schema).toBeNull();
    });

    test("should get all schemas", () => {
      const schemas = registry.getAllSchemas();
      
      expect(schemas).toHaveProperty("shell");
      expect(schemas).toHaveProperty("file");
      expect(schemas.file.description).toBe("File system operations");
    });

    test("should handle tools without schema method", () => {
      const toolWithoutSchema = {
        execute: async () => ({ result: "no schema" })
      };

      registry.register("noschema", toolWithoutSchema);
      
      expect(registry.getToolSchema("noschema")).toBeNull();
      
      const allSchemas = registry.getAllSchemas();
      expect(allSchemas).not.toHaveProperty("noschema");
    });
  });

  describe("Tool Execution", () => {
    test("should execute tool method successfully", async () => {
      // Use shell tool which has simpler output
      const result = await registry.callTool("shell", "execute", {
        command: "echo hello"
      });

      // Check that we got a result with expected structure
      expect(result).toHaveProperty("success");
      expect(result.success).toBe(true);
    });

    test("should throw error for non-existent tool", async () => {
      await expect(
        registry.callTool("nonexistent", "method", {})
      ).rejects.toThrow("Tool 'nonexistent' not found");
    });

    test("should throw error for non-existent method", async () => {
      await expect(
        registry.callTool("file", "nonexistent", {})
      ).rejects.toThrow("Method 'nonexistent' not found on tool 'file'");
    });

    test("should handle tool execution errors", async () => {
      const errorTool = {
        failingMethod: async () => {
          throw new Error("Tool execution failed");
        }
      };

      registry.register("error", errorTool);

      await expect(
        registry.callTool("error", "failingMethod", {})
      ).rejects.toThrow("Tool execution failed");
    });
  });

  describe("Activity Logging", () => {
    test("should log tool execution start and complete", async () => {
      await registry.callTool("shell", "execute", {
        command: "echo hello"
      }, "test-session");

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "tool_execution_start",
        "test-session",
        null,
        expect.objectContaining({
          tool: "shell",
          method: "execute",
          params: { command: "echo hello" }
        })
      );

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "tool_execution_complete",
        "test-session",
        null,
        expect.objectContaining({
          success: true,
          result: expect.objectContaining({ success: true }),
          error: null,
          duration_ms: expect.any(Number)
        })
      );
    });

    test("should log tool execution errors", async () => {
      const errorTool = {
        failingMethod: async () => {
          throw new Error("Execution failed");
        }
      };

      registry.register("error", errorTool);

      try {
        await registry.callTool("error", "failingMethod", {}, "test-session");
      } catch (error) {
        // Expected to throw
      }

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "tool_execution_complete",
        "test-session",
        null,
        expect.objectContaining({
          success: false,
          result: null,
          error: "Execution failed",
          duration_ms: expect.any(Number)
        })
      );
    });

    test("should not log when no session ID provided", async () => {
      await registry.callTool("file", "read", { path: "test.txt" });

      expect(mockActivityLogger.logEvent).not.toHaveBeenCalled();
    });
  });

  describe("Agent Delegate Tool", () => {
    test("should call agent delegate tool methods", async () => {
      await registry.initialize();
      registry.register("agent_delegate", new MockAgentDelegateTool());

      const result = await registry.callTool("agent_delegate", "delegate_task", {
        description: "Run tests",
        role: "execution"
      }, "test-session", null);

      expect(result).toBe("Mocked delegate_task result");
    });
  });

  describe("Snapshot Integration", () => {
    test("should create pre and post snapshots for tool execution", async () => {
      await registry.callToolWithSnapshots(
        "file",
        "write",
        { path: "test.txt", content: "hello" },
        "test-session",
        1
      );

      expect(mockSnapshotManager.createPreToolSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "file",
          operation: "write",
          parameters: { path: "test.txt", content: "hello" },
          executionId: expect.any(String)
        }),
        expect.objectContaining({
          sessionId: "test-session",
          conversationTurns: 2
        }),
        "test-session",
        1
      );

      expect(mockSnapshotManager.createPostToolSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "file",
          operation: "write"
        }),
        expect.objectContaining({
          sessionId: "test-session"
        }),
        expect.objectContaining({
          success: true,
          result: { bytesWritten: 5, success: true }
        }),
        "test-session",
        1
      );
    });

    test("should create error snapshots when tool fails", async () => {
      const errorTool = {
        failingMethod: async () => {
          throw new Error("Tool failed");
        }
      };

      registry.register("error", errorTool);

      try {
        await registry.callToolWithSnapshots(
          "error",
          "failingMethod",
          {},
          "test-session",
          1
        );
      } catch (error) {
        // Expected to throw
      }

      expect(mockSnapshotManager.createPostToolSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "error",
          operation: "failingMethod"
        }),
        expect.any(Object),
        expect.objectContaining({
          success: false,
          error: "Tool failed"
        }),
        "test-session",
        1
      );
    });

    test("should handle snapshot errors gracefully", async () => {
      mockSnapshotManager.createPreToolSnapshot.mockRejectedValueOnce(
        new Error("Snapshot failed")
      );

      // Should still execute tool despite snapshot error
      const result = await registry.callToolWithSnapshots(
        "file",
        "read",
        { path: "test.txt" },
        "test-session"
      );

      expect(result).toEqual({
        content: "hello",
        size: 5,
        success: true
      });

      expect(mockActivityLogger.logEvent).toHaveBeenCalledWith(
        "snapshot_error",
        "test-session",
        null,
        expect.objectContaining({
          error: "Snapshot failed",
          type: "pre-tool"
        })
      );
    });

    test("should fall back to regular execution when no snapshot manager", async () => {
      const registryWithoutSnapshots = new ToolRegistry({
        activityLogger: mockActivityLogger
      });
      await registryWithoutSnapshots.initialize();

      const result = await registryWithoutSnapshots.callToolWithSnapshots(
        "file",
        "read",
        { path: "test.txt" },
        "test-session"
      );

      expect(result).toEqual({
        content: "hello",
        size: 5,
        success: true
      });
    });

    test("should disable snapshots based on configuration", async () => {
      const registryWithDisabledSnapshots = new ToolRegistry({
        snapshotManager: mockSnapshotManager,
        snapshotConfig: {
          enablePreToolSnapshots: false,
          enablePostToolSnapshots: false,
          snapshotOnErrors: false
        }
      });
      await registryWithDisabledSnapshots.initialize();

      await registryWithDisabledSnapshots.callToolWithSnapshots(
        "file",
        "read",
        { path: "test.txt" },
        "test-session"
      );

      expect(mockSnapshotManager.createPreToolSnapshot).not.toHaveBeenCalled();
      expect(mockSnapshotManager.createPostToolSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("Utility Methods", () => {
    test("should generate unique execution IDs", () => {
      const id1 = registry.generateExecutionId();
      const id2 = registry.generateExecutionId();

      expect(id1).toMatch(/^exec-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^exec-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    test("should gather legacy context", async () => {
      const context = await registry.gatherSnapshotContext("test-session");

      expect(context).toEqual({
        sessionId: "test-session",
        timestamp: expect.any(String),
        conversationTurns: 2,
        recentHistory: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" }
        ]
      });
    });

    test("should handle context gathering errors gracefully", async () => {
      mockConversationDB.getConversationHistory.mockRejectedValueOnce(
        new Error("DB error")
      );

      const context = await registry.gatherSnapshotContext("test-session");

      expect(context).toEqual({
        sessionId: "test-session",
        timestamp: expect.any(String),
        conversationTurns: 0,
        recentHistory: []
      });
    });

    test("should handle missing conversation DB", async () => {
      const registryWithoutDB = new ToolRegistry();
      const context = await registryWithoutDB.gatherSnapshotContext("test-session");

      expect(context).toEqual({
        sessionId: "test-session",
        timestamp: expect.any(String)
      });
    });
  });
});
